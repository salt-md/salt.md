package server

import "testing"

// Die Endungsregel entscheidet, ob ein unbekannter Pfad 404 gibt oder die
// Anwendung lädt. Fällt sie zu weit aus, ist die Navigation kaputt; fällt sie
// zu eng aus, bekommen Bild-Abrufe wieder HTML mit Status 200.
func TestIsStaticFileName(t *testing.T) {
	static := []string{
		"favicon.ico", "icon-192.png", "logo.svg", "manifest.webmanifest",
		"sw.js", "assets/x.css", "fonts/inter.woff2", "robots.txt",
	}
	for _, p := range static {
		if !isStaticFileName(p) {
			t.Errorf("%q sollte als Datei gelten (sonst kommt index.html statt 404)", p)
		}
	}
	routes := []string{
		"", "p/abc123", "t/urlaub", "settings", "index",
		"t/version.2", "p/a.b.c", // Client-Routen dürfen Punkte enthalten
	}
	for _, p := range routes {
		if isStaticFileName(p) {
			t.Errorf("%q ist eine Client-Route und darf nicht 404 geben", p)
		}
	}
}
