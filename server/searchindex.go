package server

import (
	"log"
	"strings"
)

// Der Suchindex und seine Fassungen (W110).
//
// `pages_fts` wurde ohne Tokenizer-Angabe angelegt und lief damit auf dem
// Standard `unicode61` OHNE Diakritika-Faltung. Das kostet im Deutschen mehr,
// als es zunaechst klingt:
//
//	Verträge   findet   Vertrag   nicht
//	Straße     findet   Strasse   nicht
//	Grüße      findet   Gruesse   nicht
//
// Mit `remove_diacritics 2` faltet SQLite ä→a, ö→o, ü→u und ß→ss VOR dem
// Indexieren. Zusammen mit der Praefixsuche, die die Abfrage ohnehin schon
// anhaengt, faellt damit ein grosser Teil der deutschen Beugung von selbst weg:
// aus "Verträge" wird "vertrage", und "vertrag*" trifft es.
//
// Warum 2 und nicht 1: Fassung 1 laesst ß und einige osteuropaeische Zeichen
// stehen; Fassung 2 ist die vollstaendige Unicode-Faltung.
//
// Ein Tokenizer laesst sich an einer bestehenden FTS5-Tabelle nicht aendern —
// sie muss neu gebaut und der Bestand neu indexiert werden. Das passiert einmal
// beim Start, gesteuert ueber eine Fassungsnummer in app_settings.

// ftsVersion ist die Fassung, die dieser Build erwartet. Erhoehen, wenn sich
// die Tokenizer-Zeile oder das Spaltenlayout aendert.
const ftsVersion = "2"

// foldQuery faltet einen Suchbegriff genauso, wie der Index es tut.
//
// Noetig, weil FTS5 den Tokenizer auf den GESPEICHERTEN Text anwendet, nicht
// auf das MATCH-Muster. Ohne diese Zeile sucht jemand nach "Verträge", der
// Index enthaelt aber "vertrage" — und findet nichts.
//
// Was `remove_diacritics 2` TATSAECHLICH tut, habe ich am Index nachgesehen
// statt es anzunehmen: ä→a, ü→u, é→e. Das ß bleibt STEHEN — es ist kein
// diakritisches Zeichen, sondern ein eigener Buchstabe. Im Index steht
// "straßenbahn" und "gruße". Wer hier ß→ss faltet, sucht nach "grusse" und
// findet nie etwas; dafuer gibt es unten die Variante.
func foldQuery(s string) string {
	r := strings.NewReplacer(
		"ä", "a", "Ä", "a", "ö", "o", "Ö", "o", "ü", "u", "Ü", "u",
		"é", "e", "è", "e", "ê", "e", "á", "a", "à", "a", "â", "a",
		"í", "i", "ì", "i", "ó", "o", "ò", "o", "ô", "o", "ú", "u", "ù", "u",
		"ç", "c", "ñ", "n", "å", "a", "ø", "o",
	)
	return r.Replace(strings.ToLower(s))
}

// deutsche Endungen, die beim Suchen abgeschnitten werden — laengste zuerst.
var germanSuffixes = []string{"ungen", "erin", "chen", "lein", "heit", "keit", "enen", "ern", "est", "end", "en", "er", "es", "em", "et", "e", "n", "s"}

// stemLite schneidet eine haeufige Endung ab, damit die Praefixsuche greift.
//
// Der Fall, um den es geht: "Verträge" wird gefaltet zu "vertrage". Als
// Praefix "vertrage*" trifft das NICHT "Vertragsverlängerung" — das faengt mit
// "vertragsv" an. Erst der Stamm "vertrag*" verbindet beide. Im Deutschen mit
// seinen Zusammensetzungen ist das der Unterschied zwischen "findet die eine
// Seite" und "findet alles zum Thema".
//
// Bewusst zurueckhaltend: nur ab sechs Zeichen, und der Rest muss mindestens
// vier behalten. Sonst wird aus "Rate" ein "Rat" und die Suche schleppt das
// halbe Rathaus mit an. Der abgeschnittene Stamm ERSETZT den Begriff nicht,
// er kommt als zusaetzliche Variante dazu (siehe ftsMatch) — ein falsch
// geratener Stamm verliert damit nichts, er fuegt nur Rauschen hinzu, das
// BM25 nach hinten sortiert.
func stemLite(w string) string {
	if len([]rune(w)) < 6 {
		return w
	}
	for _, suf := range germanSuffixes {
		if strings.HasSuffix(w, suf) && len([]rune(w))-len([]rune(suf)) >= 4 {
			return strings.TrimSuffix(w, suf)
		}
	}
	return w
}

// ftsMatch baut aus einer Eingabe das MATCH-Muster.
//
// Je Wort entstehen bis zu drei Varianten, mit ODER verbunden:
//
//	gefaltet          "vertrage"*      — der Begriff, wie der Index ihn schreibt
//	Stamm             "vertrag"*       — verbindet Beugung und Zusammensetzung
//	ss/ß-Tausch       "straße"*        — weil der Index das ß behaelt, die
//	                                     Tastatur es aber oft nicht hergibt
//
// Die Woerter untereinander bleiben UND-verknuepft: wer zwei Begriffe eingibt,
// meint beide.
func ftsMatch(q string) string {
	var groups []string
	for _, raw := range strings.Fields(foldQuery(q)) {
		seen := map[string]bool{}
		var alts []string
		add := func(t string) {
			t = strings.TrimSpace(t)
			if t == "" || seen[t] {
				return
			}
			seen[t] = true
			alts = append(alts, `"`+strings.ReplaceAll(t, `"`, `""`)+`"*`)
		}
		add(raw)
		add(stemLite(raw))
		// Beide Richtungen: getipptes "strasse" soll "straße" finden und umgekehrt.
		if strings.Contains(raw, "ss") {
			add(strings.ReplaceAll(raw, "ss", "ß"))
		}
		if strings.Contains(raw, "ß") {
			add(strings.ReplaceAll(raw, "ß", "ss"))
		}
		if len(alts) == 1 {
			groups = append(groups, alts[0])
		} else {
			groups = append(groups, "("+strings.Join(alts, " OR ")+")")
		}
	}
	return strings.Join(groups, " ")
}

// migrateSearchIndex baut den Volltextindex neu, wenn er aus einer aelteren
// Fassung stammt.
//
// Der Neuaufbau laeuft synchron beim Start: bei 800 Seiten dauert er den
// Bruchteil einer Sekunde, und eine halb migrierte Suche waere schlimmer als
// ein kurzer Start. Bei sehr grossen Bestaenden ist das die Stelle, an der man
// spaeter in den Hintergrund geht.
func (s *Server) migrateSearchIndex() error {
	if s.setting("fts_version", "1") == ftsVersion {
		return nil
	}
	if _, err := s.db.Exec(`DROP TABLE IF EXISTS pages_fts`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`CREATE VIRTUAL TABLE pages_fts USING fts5(
		id UNINDEXED, title, body,
		tokenize = "unicode61 remove_diacritics 2"
	)`); err != nil {
		return err
	}

	// Alle Seiten-Ids einsammeln und ERST DANACH indexieren: reindexPage setzt
	// eigene Abfragen ab, und bei einer einzigen DB-Verbindung blockiert eine
	// Abfrage innerhalb eines offenen Cursors den ganzen Server.
	rows, err := s.db.Query(`SELECT id FROM pages WHERE trashed_at IS NULL`)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()

	failed := 0
	for _, id := range ids {
		if err := s.reindexPage(id); err != nil {
			failed++
		}
	}
	if failed > 0 {
		log.Printf("search index: %d von %d Seiten konnten nicht indexiert werden", failed, len(ids))
	}
	s.setSetting("fts_version", ftsVersion)
	log.Printf("search index: neu aufgebaut (Fassung %s, %d Seiten)", ftsVersion, len(ids)-failed)
	return nil
}
