package server

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/coder/websocket"
)

// Realtime collaboration relay.
//
// The server never interprets Yjs CRDT data. It replays the persisted
// document (snapshot + ordered update log) to joining clients, broadcasts
// live updates, and appends them to the log. Correctness rests on two
// invariants, both enforced by holding room.mu across the whole persist:
//
//  1. Ordered delivery. seq assignment, the DB insert, and enqueueing the
//     update to every connection's outbound queue all happen under room.mu,
//     so every client receives updates in seq order. A per-connection writer
//     goroutine drains that queue in order. Therefore, when we ask a specific
//     client for a snapshot at seq N (enqueued right after update N, still
//     under the lock), that client has provably been delivered every update
//     ≤ N — so its snapshot covers them and the log rows ≤ N can be dropped.
//
//  2. Atomic reset. resetYjsDoc (API/MCP rewrote the materialized content)
//     deletes the persisted state and bumps the room epoch under room.mu, and
//     empties room.conns. A persist checks membership under the same lock, so
//     an in-flight write from a now-reset connection is skipped instead of
//     resurrecting a stale row.
//
// Binary frames: [type byte][payload]
//   0 = yjs update
//   1 = awareness update (relayed, never persisted)
//   2 = client snapshot: [2][8-byte BE seq][full-state update]
// Text frames (server→client) are JSON: {"isNew":bool}, {"synced":true},
// {"snapshotRequest":seq}.
const (
	frameUpdate    = 0
	frameAwareness = 1
	frameSnapshot  = 2

	compactThreshold = 200
	outBuffer        = 512
	// wsReadLimit caps a single inbound WS frame. Must exceed a full-document
	// snapshot (pushed on reconnect); 32 MiB is far above realistic docs yet
	// still bounds memory a hostile client can force us to read.
	wsReadLimit = 32 << 20
	// closeReset tells clients the server-side doc was replaced and they must
	// reload the page instead of pushing local (now stale) state.
	closeReset websocket.StatusCode = 4001
)

type outMsg struct {
	typ  websocket.MessageType
	data []byte
}

type collabConn struct {
	ws   *websocket.Conn
	out  chan outMsg
	done chan struct{}
	once sync.Once
}

// enqueue queues a frame for the writer goroutine. Non-blocking: a client
// too slow to keep up is disconnected rather than stalling the whole room.
func (c *collabConn) enqueue(m outMsg) {
	select {
	case <-c.done:
	case c.out <- m:
	default:
		c.shutdown(websocket.StatusPolicyViolation, "slow consumer")
	}
}

func (c *collabConn) shutdown(code websocket.StatusCode, reason string) {
	c.once.Do(func() {
		close(c.done)
		c.ws.Close(code, reason)
	})
}

func (c *collabConn) writeLoop(ctx context.Context) {
	for {
		select {
		case <-c.done:
			return
		case m := <-c.out:
			if err := c.ws.Write(ctx, m.typ, m.data); err != nil {
				c.shutdown(websocket.StatusInternalError, "write failed")
				return
			}
		}
	}
}

type collabRoom struct {
	pageID string

	mu          sync.Mutex
	conns       map[*collabConn]struct{}
	loaded      bool
	seq         int64
	pending     int64
	compacting  bool
	compactConn *collabConn
	epoch       int64
	seeded      bool
	seedConn    *collabConn
}

// broadcast enqueues a frame to every connection except `from`. Caller holds room.mu.
func (r *collabRoom) broadcastLocked(from *collabConn, m outMsg) {
	for c := range r.conns {
		if c != from {
			c.enqueue(m)
		}
	}
}

type collabHub struct {
	mu    sync.Mutex
	rooms map[string]*collabRoom
}

func newCollabHub() *collabHub {
	return &collabHub{rooms: map[string]*collabRoom{}}
}

// join atomically gets-or-creates the room and adds the connection to it,
// so an empty-room drop can never slip between create and membership.
func (h *collabHub) join(pageID string, c *collabConn) *collabRoom {
	h.mu.Lock()
	defer h.mu.Unlock()
	r := h.rooms[pageID]
	if r == nil {
		r = &collabRoom{pageID: pageID, conns: map[*collabConn]struct{}{}, seq: -1}
		h.rooms[pageID] = r
	}
	r.mu.Lock()
	r.conns[c] = struct{}{}
	r.mu.Unlock()
	return r
}

// leave removes the connection and drops the room if it became empty, all
// atomically under the hub lock so a concurrent joiner cannot orphan a room.
func (h *collabHub) leave(r *collabConn, room *collabRoom) {
	h.mu.Lock()
	defer h.mu.Unlock()
	room.mu.Lock()
	delete(room.conns, r)
	if room.seedConn == r && !room.seeded {
		room.seedConn = nil // hand the seed role to the next joiner
	}
	if room.compactConn == r {
		room.compacting = false
		room.compactConn = nil
	}
	empty := len(room.conns) == 0
	room.mu.Unlock()
	if empty {
		delete(h.rooms, room.pageID)
	}
}

// resetYjsDoc discards the persisted CRDT state and kicks connected editors.
// The DB deletes and the epoch bump happen under room.mu, and room.conns is
// emptied, so any in-flight persist from a reset connection is skipped.
func (s *Server) resetYjsDoc(pageID string) {
	s.collab.mu.Lock()
	room := s.collab.rooms[pageID]
	s.collab.mu.Unlock()

	if room != nil {
		room.mu.Lock()
	}
	s.db.Exec(`DELETE FROM yjs_updates WHERE page_id = ?`, pageID)
	s.db.Exec(`DELETE FROM yjs_state WHERE page_id = ?`, pageID)
	if room == nil {
		return
	}
	room.epoch++
	room.loaded = false
	room.seq = -1
	room.pending = 0
	room.compacting = false
	room.compactConn = nil
	room.seeded = false
	room.seedConn = nil
	conns := make([]*collabConn, 0, len(room.conns))
	for c := range room.conns {
		conns = append(conns, c)
	}
	room.conns = map[*collabConn]struct{}{}
	room.mu.Unlock()
	for _, c := range conns {
		c.shutdown(closeReset, "document reset")
	}
}

// reset closes a page's editors without touching the DB (used when the page
// is trashed/deleted — the rows are removed by the caller's transaction).
func (h *collabHub) reset(pageID string) {
	h.mu.Lock()
	room := h.rooms[pageID]
	h.mu.Unlock()
	if room == nil {
		return
	}
	room.mu.Lock()
	room.epoch++
	room.loaded = false
	conns := make([]*collabConn, 0, len(room.conns))
	for c := range room.conns {
		conns = append(conns, c)
	}
	room.conns = map[*collabConn]struct{}{}
	room.mu.Unlock()
	for _, c := range conns {
		c.shutdown(closeReset, "document reset")
	}
}

func (s *Server) handleCollab(w http.ResponseWriter, r *http.Request) {
	pageID := r.PathValue("id")
	if !s.canReadReq(r, pageID) {
		httpError(w, 404, "page not found")
		return
	}
	var exists int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM pages WHERE id = ? AND trashed_at IS NULL`, pageID).Scan(&exists); err != nil || exists == 0 {
		httpError(w, 404, "page not found")
		return
	}

	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // LAN/self-host: origins vary (IP, hostname)
	})
	if err != nil {
		return
	}
	// coder/websocket defaults to a 32 KiB inbound frame cap. The client pushes
	// the FULL document state on every reconnect and on snapshot requests, so any
	// doc larger than 32 KiB (a big paste, a long page) would fail ws.Read, drop
	// the socket, reconnect, re-push, and loop forever. Raise the limit well
	// above realistic doc sizes while still bounding a malicious client.
	ws.SetReadLimit(wsReadLimit)
	ctx := r.Context()
	conn := &collabConn{ws: ws, out: make(chan outMsg, outBuffer), done: make(chan struct{})}
	go conn.writeLoop(ctx)

	room := s.collab.join(pageID, conn)

	// Load persisted state and enqueue the initial replay under room.mu, so no
	// concurrent update is missed (it is either in this read or delivered live
	// after we release the lock) and none is delivered before the replay.
	room.mu.Lock()
	var snapshot []byte
	var stateSeq int64
	haveState := s.db.QueryRow(`SELECT snapshot, seq FROM yjs_state WHERE page_id = ?`, pageID).Scan(&snapshot, &stateSeq) == nil

	type upd struct {
		seq  int64
		data []byte
	}
	var updates []upd
	if rows, err := s.db.Query(`SELECT seq, data FROM yjs_updates WHERE page_id = ? ORDER BY seq`, pageID); err == nil {
		for rows.Next() {
			var u upd
			if rows.Scan(&u.seq, &u.data) == nil {
				updates = append(updates, u)
			}
		}
		rows.Close()
	}

	if !room.loaded {
		room.seq = 0
		if haveState {
			room.seq = stateSeq
		}
		if len(updates) > 0 {
			room.seq = updates[len(updates)-1].seq
		}
		room.pending = int64(len(updates))
		room.loaded = true
	}

	isNew := !haveState && len(updates) == 0
	// Only one client seeds a brand-new doc from pages.content, so concurrent
	// first opens can't duplicate the seeded content.
	if isNew {
		if room.seeded || room.seedConn != nil {
			isNew = false
		} else {
			room.seedConn = conn
		}
	}

	hello, _ := json.Marshal(map[string]bool{"isNew": isNew})
	conn.enqueue(outMsg{websocket.MessageText, hello})
	if snapshot != nil {
		conn.enqueue(outMsg{websocket.MessageBinary, append([]byte{frameUpdate}, snapshot...)})
	}
	for _, u := range updates {
		conn.enqueue(outMsg{websocket.MessageBinary, append([]byte{frameUpdate}, u.data...)})
	}
	conn.enqueue(outMsg{websocket.MessageText, []byte(`{"synced":true}`)})
	room.mu.Unlock()

	defer s.collab.leave(conn, room)
	defer conn.shutdown(websocket.StatusNormalClosure, "")

	for {
		typ, data, err := ws.Read(ctx)
		if err != nil {
			return
		}
		if typ != websocket.MessageBinary || len(data) < 1 {
			continue
		}
		switch data[0] {
		case frameUpdate:
			s.persistUpdate(ctx, room, conn, data)
		case frameAwareness:
			room.mu.Lock()
			room.broadcastLocked(conn, outMsg{websocket.MessageBinary, data})
			room.mu.Unlock()
		case frameSnapshot:
			s.applySnapshot(room, conn, data)
		}
	}
}

func (s *Server) persistUpdate(ctx context.Context, room *collabRoom, conn *collabConn, data []byte) {
	payload := data[1:]
	room.mu.Lock()
	defer room.mu.Unlock()
	// A reset (or trash) emptied conns and bumped the epoch: this update is
	// from a stale connection, so drop it instead of resurrecting a row.
	if _, ok := room.conns[conn]; !ok {
		return
	}
	room.seeded = true
	room.seq++
	seq := room.seq
	if _, err := s.db.Exec(`INSERT INTO yjs_updates (page_id, seq, data) VALUES (?, ?, ?)`, room.pageID, seq, payload); err != nil {
		log.Printf("collab persist %s: %v", room.pageID, err)
		room.seq--
		return
	}
	room.pending++
	room.broadcastLocked(conn, outMsg{websocket.MessageBinary, data})

	if room.pending >= compactThreshold && !room.compacting {
		room.compacting = true
		room.compactConn = conn
		req, _ := json.Marshal(map[string]int64{"snapshotRequest": seq})
		conn.enqueue(outMsg{websocket.MessageText, req})
	}
}

func (s *Server) applySnapshot(room *collabRoom, conn *collabConn, data []byte) {
	if len(data) <= 9 {
		return // header only, no actual snapshot payload
	}
	upTo := int64(binary.BigEndian.Uint64(data[1:9]))
	snap := data[9:]
	room.mu.Lock()
	defer room.mu.Unlock()
	if conn != room.compactConn || !room.compacting {
		return // unsolicited or superseded (e.g. after a reset)
	}
	if upTo <= 0 || upTo > room.seq {
		room.compacting = false
		room.compactConn = nil
		return
	}
	if _, err := s.db.Exec(`INSERT INTO yjs_state (page_id, snapshot, seq) VALUES (?, ?, ?)
		ON CONFLICT(page_id) DO UPDATE SET snapshot = excluded.snapshot, seq = excluded.seq`, room.pageID, snap, upTo); err != nil {
		log.Printf("collab snapshot %s: %v", room.pageID, err)
		room.compacting = false
		room.compactConn = nil
		return
	}
	s.db.Exec(`DELETE FROM yjs_updates WHERE page_id = ? AND seq <= ?`, room.pageID, upTo)
	// Log rows added during the round-trip (seq > upTo) remain pending.
	var remaining int64
	s.db.QueryRow(`SELECT COUNT(*) FROM yjs_updates WHERE page_id = ?`, room.pageID).Scan(&remaining)
	room.pending = remaining
	room.compacting = false
	room.compactConn = nil
}
