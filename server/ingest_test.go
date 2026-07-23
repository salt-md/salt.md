package server

import (
	"encoding/json"
	"net"
	"testing"
)

// Die Sperre ist die einzige Verteidigung gegen SSRF: ohne sie koennte ein
// Agent den Server dazu bringen, Nachbarn im privaten Netz abzurufen, die von
// aussen unerreichbar sind — Hypervisor, Router, Cloud-Metadatendienste.
func TestBlockedIP(t *testing.T) {
	if allowPrivateImport {
		t.Skip("SALT_IMPORT_ALLOW_PRIVATE ist gesetzt")
	}
	blocked := []string{
		"127.0.0.1", "::1", // Schleife
		"10.0.0.5", "172.16.0.1", "192.168.1.1", // private Netze (RFC1918)
		"169.254.169.254", // Cloud-Metadaten
		"fd00::1",         // eindeutig lokal (IPv6)
		"fe80::1",         // Link-Local (IPv6)
		"0.0.0.0", "::",   // unbestimmt
		"224.0.0.1", // Multicast
	}
	for _, a := range blocked {
		if !blockedIP(net.ParseIP(a)) {
			t.Errorf("%s muss gesperrt sein — sonst ist der Import ein SSRF-Loch", a)
		}
	}
	for _, a := range []string{"1.1.1.1", "104.16.0.1", "2606:4700::1111"} {
		if blockedIP(net.ParseIP(a)) {
			t.Errorf("%s ist oeffentlich und muss erlaubt sein", a)
		}
	}
}

func TestJSONPath(t *testing.T) {
	var doc any
	json.Unmarshal([]byte(`{
		"data": {"results": [1,2]},
		"card": {"due": "2026-08-01"},
		"labels": [{"name":"Hot"},{"name":"B2B"}],
		"n": 42, "f": 1.5, "t": true
	}`), &doc)

	cases := []struct {
		path string
		want string
	}{
		{"card.due", "2026-08-01"},
		{"labels[].name", "Hot, B2B"}, // Pfluecken aus einer Liste
		{"n", "42"},                   // ganze Zahl ohne .0
		{"f", "1.5"},
		{"t", "true"},
		{"fehlt", ""},
		{"card.fehlt", ""},
		{"n.tiefer", ""}, // in einen Skalar hineinlaufen darf nicht knallen
	}
	for _, c := range cases {
		if got := scalarString(jsonPath(doc, c.path)); got != c.want {
			t.Errorf("jsonPath(%q) = %q, erwartet %q", c.path, got, c.want)
		}
	}
}

// Der eigentliche Fall: eine Trello-Antwort, bei der die Karte nur die Id ihrer
// Liste kennt und der Klartext woanders steht. Ohne resolve stuende in der
// Status-Spalte eine nichtssagende Id.
func TestMapItemsTrelloShape(t *testing.T) {
	var doc any
	json.Unmarshal([]byte(`{
		"lists": [{"id":"L1","name":"Heiße Kontakte"},{"id":"L2","name":"Verloren"}],
		"cards": [
			{"name":"Notar Thelen","desc":"Erstgespräch","idList":"L1","due":"2026-08-01",
			 "labels":[{"name":"Hot"},{"name":"B2B"}]},
			{"name":"","desc":"","idList":"L2","labels":[]}
		]
	}`), &doc)

	items, err := mapItems(doc, ingestSpec{
		Items: "cards", Title: "name", Markdown: "desc",
		Properties: map[string]string{"Status": "idList", "Fällig": "due", "Labels": "labels[].name"},
		Resolve:    map[string]ingestResolve{"idList": {From: "lists", Match: "id", To: "name"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("erwartet 2 Eintraege, bekommen %d", len(items))
	}
	if items[0].title != "Notar Thelen" || items[0].md != "Erstgespräch" {
		t.Errorf("Titel/Inhalt falsch: %q / %q", items[0].title, items[0].md)
	}
	if got := scalarString(items[0].props["Status"]); got != "Heiße Kontakte" {
		t.Errorf("Status = %q, erwartet den aufgeloesten Listennamen statt der Id", got)
	}
	if got := scalarString(items[0].props["Labels"]); got != "Hot, B2B" {
		t.Errorf("Labels = %q", got)
	}
	// Ein leerer Titel darf den Import nicht abbrechen — sonst scheitert eine
	// Migration an einer einzigen unbenannten Karte.
	if items[1].title != "Untitled 2" {
		t.Errorf("leerer Titel = %q, erwartet einen Platzhalter", items[1].title)
	}
}

func TestMapItemsRejectsBadPath(t *testing.T) {
	var doc any
	json.Unmarshal([]byte(`{"cards":[{"name":"A"}]}`), &doc)
	if _, err := mapItems(doc, ingestSpec{Items: "karten", Title: "name"}); err == nil {
		t.Error("ein falscher items-Pfad muss einen Fehler geben, nicht still 0 Eintraege")
	}
}

func TestValueStrings(t *testing.T) {
	var arr any
	json.Unmarshal([]byte(`["Hot","",  "B2B"]`), &arr)
	got := valueStrings(arr)
	if len(got) != 2 || got[0] != "Hot" || got[1] != "B2B" {
		t.Errorf("valueStrings = %v, leere Werte muessen wegfallen", got)
	}
}
