package server

import (
	"io/fs"
	"net/http"
	"net/url"
	"strings"
)

// spaHandler serves the embedded frontend build and falls back to index.html
// for client-side routes like /p/<id>.
func spaHandler(dist fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p != "" {
			if f, err := dist.Open(p); err == nil {
				f.Close()
				// Vite content-hashes everything under assets/, so those may
				// be cached forever — but only when the file actually exists.
				if strings.HasPrefix(p, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				// Go's mime table doesn't know .webmanifest; the service worker
				// must never be cached (it IS the cache).
				if strings.HasSuffix(p, ".webmanifest") {
					w.Header().Set("Content-Type", "application/manifest+json")
				}
				if p == "sw.js" {
					w.Header().Set("Cache-Control", "no-cache")
				}
				fileServer.ServeHTTP(w, r)
				return
			}
			// A missing hashed asset (e.g. after a redeploy) must 404 instead
			// of returning index.html, or browsers cache the wrong response.
			// Dasselbe gilt für alles, was erkennbar eine Datei sein soll: ein
			// Abruf von /favicon.ico bekam sonst index.html mit Status 200, und
			// wer ein Bild erwartet, sieht dann gar nichts statt eines ehrlichen
			// 404. Bewusst eine feste Endungsliste statt „enthält einen Punkt" —
			// Client-Routen wie /t/<tag> dürfen Punkte enthalten.
			if strings.HasPrefix(p, "assets/") || isStaticFileName(p) {
				http.NotFound(w, r)
				return
			}
		}
		r2 := new(http.Request)
		*r2 = *r
		r2.URL = new(url.URL)
		*r2.URL = *r.URL
		r2.URL.Path = "/"
		fileServer.ServeHTTP(w, r2)
	})
}

// staticFileExts sind Endungen, bei denen ein Treffer eine echte Datei sein
// MUSS — fehlt sie, ist das ein 404 und keine Client-Route.
var staticFileExts = []string{
	".ico", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif",
	".css", ".js", ".mjs", ".map", ".json", ".webmanifest",
	".woff", ".woff2", ".ttf", ".otf", ".txt", ".xml",
}

func isStaticFileName(p string) bool {
	i := strings.LastIndexByte(p, '/')
	name := p[i+1:]
	for _, ext := range staticFileExts {
		if strings.HasSuffix(name, ext) {
			return true
		}
	}
	return false
}
