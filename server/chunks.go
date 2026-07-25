package server

import (
	"encoding/json"
	"strings"
)

// Seiten in Abschnitte schneiden (W110, Stufe 1).
//
// Warum ueberhaupt: bisher ist die kleinste Einheit der Suche die SEITE. Ein
// Treffer sagt "in diesem 4000-Wort-Dokument steht etwas" und liefert 14
// Woerter Umgebung. Fuer einen Menschen reicht das, er scrollt. Fuer einen
// Agenten nicht — er bekommt entweder zu wenig, um zu antworten, oder er laedt
// die ganze Seite und verbrennt sein Kontextfenster an Text, der nichts mit
// der Frage zu tun hat.
//
// Geschnitten wird entlang der BLOCKGRENZEN, nicht nach Zeichenzahl. Ein
// Abschnitt, der mitten im Satz beginnt, ist als Antwort wertlos; einer, der
// an einer Ueberschrift beginnt, traegt seinen Zusammenhang mit. Dieselbe
// Entscheidung wie im Nachbarprojekt, wo pro Gespraechsblock geschnitten wird,
// damit ein Treffer auf den tatsaechlichen Wortwechsel zeigt.
//
// Jeder Abschnitt merkt sich ausserdem die Ueberschriften ueber ihm
// ("Vertrag › Kündigung › Fristen"). Das ist die Auskunft, die einem Agenten
// erlaubt, einen Absatz einzuordnen, ohne die Seite zu laden.

const (
	// Zielgroesse eines Abschnitts. Gross genug fuer einen Gedanken, klein
	// genug, dass ein Treffer noch etwas aussagt.
	chunkTarget = 700
	// Ab hier wird auch mitten in einem sehr langen Block getrennt — sonst
	// waere eine Tabelle mit 20 000 Zeichen ein einziger Abschnitt.
	chunkHardMax = 1800
)

type pageChunk struct {
	Ord     int
	Heading string // Ueberschriften-Pfad, z. B. "Verträge › Kündigung"
	Text    string
}

// chunkContent zerlegt BlockNote-JSON in Abschnitte.
func chunkContent(raw []byte) []pageChunk {
	var blocks []mdBlock
	if json.Unmarshal(raw, &blocks) != nil {
		return nil
	}
	var out []pageChunk
	var trail []string // aktueller Ueberschriften-Pfad
	var buf strings.Builder
	bufHeading := ""

	flush := func() {
		t := strings.TrimSpace(buf.String())
		buf.Reset()
		if t == "" {
			return
		}
		out = append(out, pageChunk{Ord: len(out), Heading: bufHeading, Text: t})
	}

	var walk func(bs []mdBlock)
	walk = func(bs []mdBlock) {
		for _, blk := range bs {
			text := strings.TrimSpace(blockPlainText(blk))
			if blk.Type == "heading" {
				// Eine Ueberschrift beginnt einen neuen Abschnitt: sie ist die
				// Grenze, die der Mensch beim Schreiben selbst gezogen hat.
				flush()
				level := intProp(blk.Props, "level", 1)
				if level < 1 {
					level = 1
				}
				if level > len(trail) {
					trail = append(trail, text)
				} else {
					trail = append(trail[:level-1], text)
				}
				bufHeading = strings.Join(trail, " › ")
				// Die Ueberschrift selbst gehoert in den Text, sonst findet die
				// Suche sie im Abschnitt nicht wieder.
				buf.WriteString(text)
				buf.WriteString("\n")
				walk(blk.Children)
				continue
			}
			if text != "" {
				if buf.Len() == 0 {
					bufHeading = strings.Join(trail, " › ")
				}
				// Sehr lange Bloecke hart trennen, damit ein Abschnitt eine
				// lesbare Groesse behaelt.
				for len(text) > chunkHardMax {
					cut := lastSpaceBefore(text, chunkHardMax)
					buf.WriteString(text[:cut])
					flush()
					bufHeading = strings.Join(trail, " › ")
					text = strings.TrimSpace(text[cut:])
				}
				buf.WriteString(text)
				buf.WriteString("\n")
				if buf.Len() >= chunkTarget {
					flush()
					bufHeading = strings.Join(trail, " › ")
				}
			}
			walk(blk.Children)
		}
	}
	walk(blocks)
	flush()
	return out
}

// lastSpaceBefore sucht die letzte Wortgrenze vor max — damit ein harter
// Schnitt wenigstens nicht mitten in einem Wort landet.
func lastSpaceBefore(s string, max int) int {
	if len(s) <= max {
		return len(s)
	}
	if i := strings.LastIndexAny(s[:max], " \n\t"); i > max/2 {
		return i
	}
	return max
}

// blockPlainText holt den sichtbaren Text EINES Blocks (ohne seine Kinder).
func blockPlainText(blk mdBlock) string {
	if len(blk.Content) == 0 {
		return ""
	}
	var inl []mdInline
	if json.Unmarshal(blk.Content, &inl) != nil {
		// Tabellen und andere Sonderformen haben eine eigene Struktur —
		// dafuer der allgemeine Weg.
		return strings.TrimSpace(extractText(blk.Content))
	}
	var b strings.Builder
	for _, i := range inl {
		if i.Text != "" {
			b.WriteString(i.Text)
			b.WriteString(" ")
		}
		if i.Type == "pageLink" {
			if label, ok := i.Props["label"].(string); ok {
				b.WriteString(label)
				b.WriteString(" ")
			}
		}
	}
	return strings.TrimSpace(b.String())
}

// reindexChunks schreibt die Abschnitte einer Seite neu.
//
// Laeuft im selben Atemzug wie reindexPage. Der Loeschweg braucht nichts
// Eigenes: page_chunks haengt per Fremdschluessel an pages, und chunks_fts
// wird hier mitgefuehrt (eine virtuelle Tabelle kennt keine Kaskade).
func (s *Server) reindexChunks(pageID, workspaceID, title string, content []byte, trashed bool) error {
	if _, err := s.db.Exec(`DELETE FROM chunks_fts WHERE chunk_id IN
		(SELECT id FROM page_chunks WHERE page_id = ?)`, pageID); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DELETE FROM page_chunks WHERE page_id = ?`, pageID); err != nil {
		return err
	}
	if trashed {
		return nil
	}
	chunks := chunkContent(content)
	if len(chunks) == 0 {
		// Eine leere Seite bekommt trotzdem einen Abschnitt aus ihrem Titel,
		// sonst verschwindet sie aus der abschnittsbasierten Suche.
		if strings.TrimSpace(title) == "" {
			return nil
		}
		chunks = []pageChunk{{Ord: 0, Text: title}}
	}
	for _, c := range chunks {
		id := newID()
		if _, err := s.db.Exec(`INSERT INTO page_chunks (id, page_id, workspace_id, ord, heading, text)
			VALUES (?, ?, ?, ?, ?, ?)`, id, pageID, workspaceID, c.Ord, c.Heading, c.Text); err != nil {
			return err
		}
		// Der Titel kommt in jeden Abschnitt: sonst findet "Vertrag Kündigung"
		// nichts, wenn das eine im Titel und das andere im Absatz steht.
		if _, err := s.db.Exec(`INSERT INTO chunks_fts (chunk_id, title, heading, text) VALUES (?, ?, ?, ?)`,
			id, title, c.Heading, c.Text); err != nil {
			return err
		}
	}
	return nil
}
