package server

import (
	"io"
	"log"
	"strings"

	"github.com/ledongthuc/pdf"
)

// extractPDFText best-effort extracts plain text from a PDF for indexing.
// PDF parsing is messy; failures (including panics from malformed files)
// degrade to an empty string, never to an error for the caller.
func extractPDFText(path string) (text string) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("pdf extract %s: recovered: %v", path, r)
			text = ""
		}
	}()
	f, r, err := pdf.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	reader, err := r.GetPlainText()
	if err != nil {
		return ""
	}
	var b strings.Builder
	if _, err := io.Copy(&b, reader); err != nil {
		return ""
	}
	out := b.String()
	// Cap the indexed text; FTS on a whole book is not worth the DB weight.
	if len(out) > 500_000 {
		out = out[:500_000]
	}
	return out
}

// indexFileText stores extracted file text and refreshes the owning page.
func (s *Server) indexFileText(fileName, pageID, text string) {
	if strings.TrimSpace(text) == "" {
		return
	}
	if _, err := s.db.Exec(`INSERT INTO file_texts (file_name, page_id, text) VALUES (?, ?, ?)
		ON CONFLICT(file_name) DO UPDATE SET page_id = excluded.page_id, text = excluded.text`,
		fileName, pageID, text); err != nil {
		log.Printf("index file text: %v", err)
		return
	}
	if pageID != "" {
		if err := s.reindexPage(pageID); err != nil {
			log.Printf("reindex after file: %v", err)
		}
	}
}
