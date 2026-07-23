package server

import (
	"fmt"
	"net/http"
	"sync"
	"time"
)

// eventHub is a minimal fan-out bus for server-sent events ("something
// changed, refetch"). Slow subscribers drop events instead of blocking.
type eventHub struct {
	mu   sync.Mutex
	subs map[chan string]struct{}
}

func newEventHub() *eventHub {
	return &eventHub{subs: map[chan string]struct{}{}}
}

func (h *eventHub) subscribe() chan string {
	ch := make(chan string, 16)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *eventHub) unsubscribe(ch chan string) {
	h.mu.Lock()
	delete(h.subs, ch)
	h.mu.Unlock()
}

func (h *eventHub) broadcast(event string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- event:
		default:
		}
	}
}

// pagesChanged tells all clients the page tree metadata changed.
func (s *Server) pagesChanged() {
	s.events.broadcast(`{"type":"pages"}`)
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		httpError(w, 500, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	ch := s.events.subscribe()
	defer s.events.unsubscribe(ch)

	fmt.Fprintf(w, "data: {\"type\":\"hello\",\"version\":%q}\n\n", Version)
	fl.Flush()

	keepalive := time.NewTicker(25 * time.Second)
	defer keepalive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case ev := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", ev)
			fl.Flush()
		case <-keepalive.C:
			fmt.Fprint(w, ": keepalive\n\n")
			fl.Flush()
		}
	}
}
