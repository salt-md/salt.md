# Konzept: Suche mit Kontext, lokal

Ziel: nicht nur nach Wörtern suchen, sondern nach Bedeutung — „Wo steht was
zum Thema Kündigungsfristen?" soll auch Seiten finden, in denen das Wort
Kündigungsfrist nirgends vorkommt. Ohne Netz nach außen, ohne GPU, ohne MCP,
im selben einen Binary.

Dieses Papier beschreibt, was dafür nötig ist, in welcher Reihenfolge, und wo
die Fallen liegen. Es ist ein Plan, kein Beschluss.

---

## 1. Die Regel, die nicht verhandelbar ist

Der heutige Suchindex (`pages_fts`) enthält **jede Seite der ganzen Instanz**
und kennt keine Rechte. Dass niemand Fremdes darin auftaucht, liegt allein an
der Abfrage — und die filtert in **zwei** Stufen:

1. `WHERE p.workspace_id IN (…)` — nur Workspaces, in denen die Person
   Mitglied ist (plus laufender Notfallzugriff), verengt um den Token-Scope
2. `canRead` je Treffer — das fängt **private Seiten anderer innerhalb** eines
   Workspace, den man betreten darf

Jede neue Suche muss beide Stufen haben. Die zweite wird vergessen, weil sie
sich anfühlt wie ein Sonderfall; sie ist der häufigere Fall.

**Ein Vektor ist Inhalt, keine Metadatenzeile.** Was ein Modell aus einer Seite
errechnet, verrät ihr Thema. Einbettungen gehören damit in dieselbe
Schutzklasse wie `pages.body`:

- mit der Seite löschen (Fremdschlüssel, so wie `page_revisions`)
- mit dem Workspace löschen (in `purgeWorkspace` aufnehmen, so wie `pages_fts`)
- im Export nur mitgeben, was die exportierende Person ohnehin sehen darf
- niemals einen „globalen" Ähnlichkeitsendpunkt ohne Workspace-Filter

---

## 2. Was heute schon schwächelt

Bevor irgendein Modell dazukommt, drei Dinge am Bestehenden:

**Der Abschneide-Fehler.** `LIMIT 40` steht **vor** dem `canRead`-Filter,
abgebrochen wird bei 20 Treffern. Wer in einem Workspace mit vielen fremden
privaten Seiten sucht, bekommt still zu wenige Ergebnisse. Behebung wie im
Protokoll: nachladen, bis genug übrig ist, oder deutlich überziehen.

**Kein Stemming, keine Umlaut-Faltung.** `pages_fts` läuft mit dem
Standard-Tokenizer. „Verträge" findet „Vertrag" nicht, „Strasse" findet
„Straße" nicht. FTS5 kann das (`tokenize = "unicode61 remove_diacritics 2"`,
dazu ein Wörterbuch oder Porter für Englisch) — kostet nur einen Neuaufbau des
Index.

**Nur Präfix-Treffer.** Die Abfrage hängt an jeden Begriff ein `*`. Das ist
gut für Tippen im Suchfeld und schlecht für ganze Sätze.

Diese drei zu beheben bringt spürbar mehr als das erste Modell — und sie
gelten weiter, wenn das Modell kommt.

---

## 3. Was im Agent-Repo schon gelöst ist

Im Nachbarprojekt (`~/Code/agent`, Node/TypeScript) läuft genau diese Suche
bereits — dort für Fähigkeiten und für das Gedächtnis. Es hat mit Salt.md
nichts zu tun und wird auch nicht Teil davon: es ist eine Quelle für
Entscheidungen, die dort schon einmal getroffen und im Betrieb geprüft wurden.
Der Code ist ohnehin nicht übertragbar (Node gegen Go ohne CGO), die
Entscheidungen sind es:

**Kein Vektorindex bei dieser Größe.** Im Kommentar von `src/skills/semantic.ts`
steht es wörtlich: für Homelab-Maßstab braucht es keine Vektordatenbank —
einbetten, in SQLite zwischenspeichern, roher Kosinus über die kleine Menge.
Dieselbe Rechnung wie in Abschnitt 7. pgvector liegt hinter derselben
Schnittstelle bereit, falls es je nötig wird.

**Zwischenspeichern über einen Inhalts-Hash.** Nur was sich geändert hat, wird
neu berechnet; bei einem angehängten Absatz kostet das Nachführen einen Absatz,
nicht die Seite.

**Schnittgrenzen entlang der Struktur, nicht nach Zeichenzahl.** Dort wird pro
Gesprächsblock geschnitten, damit ein Treffer auf den tatsächlichen Wortwechsel
zeigt. Für uns heißt das: an Blockgrenzen schneiden, nicht alle 700 Zeichen
mitten im Satz.

**Eine Kaskade statt eines Schalters.** `semantic → FTS5 → Teilstring`. Fehlt
das Modell, ist der Zwischenspeicher kalt oder die Einbettung schlägt fehl,
fällt die Suche eine Stufe tiefer — sie geht nie kaputt.

**Eine Signatur über dem Zwischenspeicher.** `embedderSignature()` merkt sich,
welches Modell die Vektoren erzeugt hat. Vektoren verschiedener Modelle liegen
in verschiedenen Räumen und dürfen nie miteinander verglichen werden. Genau
dafür ist die `model`-Spalte im Datenmodell unten da.

**Threads gepinnt.** Der eingebaute Embedder setzt `intraOpNumThreads` auf 1 —
begrenzt die Last auf einer kleinen Kiste und umgeht, dass ein LXC-Container
keine CPU-Affinität setzen darf. Das betrifft unseren Proxmox-Container direkt.

**Ein Zeitfenster.** Nur die letzten 120 Tage werden eingebettet, älteres bleibt
bei der Volltextsuche. Ein Weg, die Menge klein zu halten, den wir uns notieren
sollten — bei uns wäre das eher „nur nicht archivierte Seiten".

Und der Unterschied, der alles entscheidet: **der Agent hat genau einen
Benutzer.** Es gibt dort keine Rechteprüfung, weil es keine geben muss. Wer
diese Bausteine übernimmt, ohne die zwei Filter aus Abschnitt 1 einzuziehen,
baut das Leck ein, das dieses Papier verhindern soll.

---

## 4. Stufenplan

### Stufe 0 — die Volltextsuche schärfen

Abschneide-Fehler, Umlaut-Faltung, Stemming. Kein neues Datenmodell, kein
Modell, keine neuen Abhängigkeiten. Ein Nachmittag.

### Stufe 1 — der Weg, noch ohne Modell

Die Abschnittstabelle anlegen, beim Speichern füllen, die Suche darüber laufen
lassen — zunächst nur mit dem Volltext. Damit steht das ganze Gerüst: das
Schneiden, das Nachführen beim Schreiben, das Mitlöschen, und vor allem die
Rechteprüfung aus Abschnitt 1. Alles davon lässt sich prüfen, bevor eine
einzige Zahl aus einem Modell kommt.

Das ist die Stufe, die man nicht überspringt. Wer mit dem Modell anfängt, baut
die Rechteprüfung nebenbei und merkt Fehler darin nicht, weil die Ergebnisse
ja plausibel aussehen.

### Stufe 2 — das kleine Modell, im Programm

Kein Dienst nebenan, kein Endpunkt, keine Adresse zum Eintragen: das Modell
läuft im selben Programm auf der CPU. Das ist der Punkt der ganzen Übung — eine
Instanz soll nach dem Auspacken alles können, auch ohne Netz nach außen.

In Go ohne CGO gibt es dafür zwei ernsthafte Wege, plus eine billigere
Näherung:

| Weg | Größe | Güte | Aufwand |
|---|---|---|---|
| **Statische Wortvektoren** (gewichteter Mittelwert, SIF) | 20–40 MB | ordentlich für „thematisch verwandt", blind für Wortstellung und Verneinung | reines Go, ein paar Dutzend Zeilen Mathematik |
| **wazero + Modell als WASM** | 30–120 MB | echte Satzbedeutung | reines Go-Laufzeit, aber Modell muss übersetzt und angebunden werden |
| **spago** (reines Go, BERT-Familie) | dito | dito | passt zur MiniLM-Architektur; Reifegrad und Tempo vorher messen |

Was ausscheidet: `onnxruntime`-Bindings (CGO, beerdigt das Ein-Binary-Versprechen),
ein Sidecar-Prozess (aus einem Binary wird ein Gespann) und Einbetten im
Browser (jedes Handy lädt 100 MB).

**Reihenfolge innerhalb der Stufe:** erst die statischen Vektoren. Sie sind an
einem Tag gebaut, kosten Mikrosekunden je Seite und liefern eine Messlatte. Ist
die Suche damit gut genug, ist die Sache erledigt. Ist sie es nicht, weiß man
beim Prototyp von wazero und spago wenigstens, wogegen man misst.

**Wo das Modell herkommt.** 120 MB in ein 24-MB-Binary zu legen, ist zu viel.
Drei Möglichkeiten: eine quantisierte Fassung (~30–40 MB) mit `go:embed`
einbacken, sie beim ersten Bedarf einmalig herunterladen (bricht „läuft ohne
Netz"), oder ins Docker-Image legen und beim Binary weglassen. Ich würde
einbacken, wenn die quantisierte Fassung gut genug ist — sonst ist das
Versprechen der einen Datei nur noch die halbe Wahrheit.

**Modellwahl** falls es dazu kommt: `paraphrase-multilingual-MiniLM-L12-v2`,
384 Dimensionen. Mehrsprachig, damit deutsche Seiten ordentlich einbetten,
klein genug für die CPU — und im Nachbarprojekt an echtem Material erprobt.

### Verworfen: ein Endpunkt zum Eintragen

Naheliegend wäre, die Einbettung an einen OpenAI-kompatiblen Dienst
auszulagern (Ollama & Co.). Das wäre die geringste Arbeit und ist trotzdem
falsch für dieses Projekt: es macht aus „eine Datei, fertig" ein „eine Datei
plus ein Dienst, den du selbst betreiben musst". Wer das will, hat die
Volltextsuche und braucht uns nicht. Notiert, damit die Frage nicht zweimal
gestellt wird.

---

## 5. Datenmodell

Eine Seite ist zu groß für einen Vektor. Geschnitten wird in Abschnitte von
grob 500–800 Zeichen entlang der Blockgrenzen, mit etwas Überlappung.

```sql
CREATE TABLE page_chunks (
  id           TEXT PRIMARY KEY,
  page_id      TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,   -- denormalisiert: der Filter läuft VOR der Suche
  ord          INTEGER NOT NULL,
  text         TEXT NOT NULL,   -- für den Textausschnitt im Ergebnis
  vec          BLOB NOT NULL,   -- int8-quantisiert, Länge = Dimensionen
  model        TEXT NOT NULL,   -- Name+Version; fremde Zeilen werden ignoriert
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_chunk_ws ON page_chunks(workspace_id);
```

`workspace_id` steht bewusst doppelt in der Tabelle: so lässt sich **vor** dem
Rechnen einschränken, statt hinterher wegzuwerfen.

`model` erlaubt den Wechsel ohne Migration: neue Zeilen mit neuem Namen
schreiben, alte beim Aufräumen entfernen, die Abfrage nimmt nur den aktuellen.

---

## 6. Der Abfrageweg

```
Frage
  └─ Vektor der Frage (dasselbe Verfahren wie beim Indexieren)
       └─ erlaubte Workspaces bestimmen  (Mitgliedschaft + Notfallzugriff + Token-Scope)
            └─ Kandidaten: page_chunks WHERE workspace_id IN (…) AND model = ?
                 └─ Kosinus gegen alle Kandidaten, beste N je Seite
                      └─ canRead je Seite      ← die Stufe, die gern fehlt
                           └─ mit BM25-Treffern verschmelzen (RRF), 20 ausgeben
```

**Erst filtern, dann rechnen.** Der umgekehrte Weg („die 20 ähnlichsten, dann
Rechte prüfen") liefert Menschen mit wenig Leserechten regelmäßig null Treffer,
obwohl passende Seiten existieren — derselbe Fehler wie der Abschneide-Fehler
in Stufe 0, nur schwerer zu bemerken.

**Verschmelzen statt ersetzen.** Reine Bedeutungssuche ist schlecht bei
Eigennamen, Aktenzeichen, Kundennummern — also genau dem, was Leute im
Arbeitsalltag suchen. BM25 und Kosinus getrennt ranken und die Ränge
zusammenführen (Reciprocal Rank Fusion, drei Zeilen) schlägt beides einzeln.

---

## 7. Was es kostet

Gerechnet mit 384 Dimensionen, int8 (384 Byte je Abschnitt):

| Bestand | Abschnitte | Speicher | Kosinus über alle |
|---|---|---|---|
| die Instanz heute (805 Seiten) | ~2 500 | ~1 MB | < 1 ms |
| mittlere Firma (10 000 Seiten) | ~35 000 | ~13 MB | ~5 ms |
| groß (100 000 Seiten) | ~350 000 | ~130 MB | ~50 ms |

**Daraus folgt das Wichtigste an diesem Papier: es braucht vorerst keinen
Vektorindex.** Ein linearer Durchlauf über die erlaubten Abschnitte ist bis in
sechsstellige Bereiche schnell genug und hat keine der Wartungskosten von
HNSW & Co. — kein Neuaufbau, keine Parameter, keine stillen Fehltreffer. Die
Entscheidung für einen echten Index verschiebt sich damit auf ein Problem, das
diese Instanzen vermutlich nie haben.

Indexieren kostet einmalig: bei Stufe 1 Sekunden für den Gesamtbestand, bei
Stufe 2 rund 10–30 ms je Abschnitt auf einem Container-Kern, also für 2 500
Abschnitte etwa eine Minute — im Hintergrund, mit derselben Warteschlange wie
der Massenimport.

---

## 8. Lebenszyklus

| Ereignis | Was passiert |
|---|---|
| Seite gespeichert | Abschnitte neu berechnen, wie `reindexPage` heute |
| Seite in den Papierkorb | Abschnitte behalten, aber aus der Suche nehmen (`trashed_at`) |
| Seite endgültig gelöscht | fällt per Fremdschlüssel weg |
| Workspace gelöscht | in `purgeWorkspace` mit löschen — sonst bleibt vom gelöschten Bereich ein Schatten liegen, aus dem sich Themen rekonstruieren lassen |
| Modell gewechselt | neue Zeilen mit neuem `model`, alte im Hintergrund entfernen |
| Export / Backup | Vektoren sind Inhalt: nur mit den Seiten, die mitgehen dürfen |

---

## 9. Was ich nicht tun würde

- **Kein „ähnliche Seiten"-Endpunkt ohne Rechteprüfung.** Er wirkt harmlos und
  ist die bequemste Art, den Workspace-Filter zu umgehen.
- **Kein Volltext an ein fremdes Modell.** Sobald ein Schlüssel für eine
  Fremd-API im Spiel ist, gilt das Versprechen der Instanz nicht mehr — und es
  steht in keiner Einstellung, dass es nicht mehr gilt.
- **Keine Vektoren im Klartext-Export**, solange nicht klar ist, wer ihn öffnet.
- **Kein ANN-Index, bevor die lineare Suche wirklich zu langsam ist.** Siehe
  Abschnitt 7; das wird lange dauern.
- **Kein Modell im selben Prozess ohne Speichergrenze.** Ein Container mit
  512 MB ist der Normalfall beim Selfhosting.

---

## 10. Reihenfolge

1. **Stufe 0** — Abschneide-Fehler, Umlaute, Stemming. Sofort, unabhängig vom
   Rest. Wirkt auch dann, wenn nie ein Modell dazukommt.
2. **Stufe 1** — Abschnittstabelle und Indexierung, zunächst nur mit Volltext.
   Der Weg steht, die Rechteprüfung ist erprobt, bevor Vektoren im Spiel sind.
3. **Stufe 2a** — statische Wortvektoren, Verschmelzung mit BM25. An eigenem
   Material messen, ob es reicht.
4. **Stufe 2b** nur, wenn 2a nachweislich zu schwach ist — dann wazero oder
   spago, vorher gegeneinander gemessen.

Der Sprung von 1 auf 2 ist klein, wenn 1 richtig gebaut ist: es kommt eine
Spalte hinzu und eine Funktion, die sie füllt.
