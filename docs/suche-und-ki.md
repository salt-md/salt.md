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

## 3. Stufenplan

### Stufe 0 — die Volltextsuche schärfen

Abschneide-Fehler, Umlaut-Faltung, Stemming. Kein neues Datenmodell, kein
Modell, keine neuen Abhängigkeiten. Ein Nachmittag.

### Stufe 1 — Kontext ohne neuronales Netz

Bedeutungsähnlichkeit lässt sich zu einem großen Teil mit **statischen
Wortvektoren** erreichen: eine Tabelle Wort → 100–300 Zahlen, einmal
mitgeliefert. Der Vektor eines Absatzes ist der gewichtete Mittelwert seiner
Wortvektoren (SIF: seltene Wörter zählen mehr, die Hauptkomponente wird
abgezogen — zwei Dutzend Zeilen Mathematik).

Warum das hier der richtige Einstieg ist:

- **Reines Go, kein CGO.** Der Build bleibt `CGO_ENABLED=0`, ein Binary,
  fünf Plattformen. Das ist keine Nebensache, sondern das Versprechen des
  Projekts.
- **Kosten pro Seite: Mikrosekunden.** Läuft auf dem Proxmox-Container mit,
  ohne dass jemand es merkt.
- **Deterministisch.** Gleicher Text, gleicher Vektor — kein Modell-Zoo, keine
  Versionsdrift.
- Qualität: deutlich über Schlagwort, deutlich unter Transformer. Für „finde
  Verwandtes" und „was gehört thematisch zusammen" reicht es.

Größe: ein auf die häufigsten ~200 000 deutschen und englischen Wörter
gekürztes, int8-quantisiertes Vektorenset liegt bei 20–40 MB. Das verdoppelt
das Binary — vertretbar, aber es ist die Entscheidung, die man bewusst treffen
muss.

### Stufe 2 — echte Satz-Einbettungen

Ein kleines Transformer-Modell (Klasse `multilingual-e5-small`, 384
Dimensionen, ~120 M Parameter, int8) versteht Wortstellung und Verneinung, was
Stufe 1 nicht kann. Das Problem ist nicht das Modell, sondern **wie es ohne C
läuft**:

| Weg | Einschätzung |
|---|---|
| `onnxruntime`-Bindings | schnell, aber CGO — beerdigt das Ein-Binary-Versprechen |
| Sidecar-Prozess | funktioniert, macht aus dem Binary ein Gespann; für Selfhoster ein Rückschritt |
| **wazero + Modell als WASM** | reines Go, kein CGO, läuft überall. Etwa 2–4× langsamer als nativ — bei diesen Größen egal |
| Einbetten im Browser | keine Serverlast, aber jeder Client lädt das Modell; auf dem Handy unzumutbar, und Altbestand muss trotzdem irgendwo indexiert werden |

Empfehlung, falls Stufe 2 kommt: **wazero**. Es ist der einzige Weg, der die
Auslieferung nicht verändert.

---

## 4. Datenmodell

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

## 5. Der Abfrageweg

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

## 6. Was es kostet

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

## 7. Lebenszyklus

| Ereignis | Was passiert |
|---|---|
| Seite gespeichert | Abschnitte neu berechnen, wie `reindexPage` heute |
| Seite in den Papierkorb | Abschnitte behalten, aber aus der Suche nehmen (`trashed_at`) |
| Seite endgültig gelöscht | fällt per Fremdschlüssel weg |
| Workspace gelöscht | in `purgeWorkspace` mit löschen — sonst bleibt vom gelöschten Bereich ein Schatten liegen, aus dem sich Themen rekonstruieren lassen |
| Modell gewechselt | neue Zeilen mit neuem `model`, alte im Hintergrund entfernen |
| Export / Backup | Vektoren sind Inhalt: nur mit den Seiten, die mitgehen dürfen |

---

## 8. Was ich nicht tun würde

- **Kein „ähnliche Seiten"-Endpunkt ohne Rechteprüfung.** Er wirkt harmlos und
  ist die bequemste Art, den Workspace-Filter zu umgehen.
- **Kein Volltext an ein fremdes Modell.** Sobald ein Schlüssel für eine
  Fremd-API im Spiel ist, gilt das Versprechen der Instanz nicht mehr — und es
  steht in keiner Einstellung, dass es nicht mehr gilt.
- **Keine Vektoren im Klartext-Export**, solange nicht klar ist, wer ihn öffnet.
- **Kein ANN-Index, bevor die lineare Suche wirklich zu langsam ist.** Siehe
  Tabelle oben; das wird lange dauern.
- **Kein Modell im selben Prozess ohne Speichergrenze.** Ein Container mit
  512 MB ist der Normalfall beim Selfhosting.

---

## 9. Reihenfolge

1. **Stufe 0** — Abschneide-Fehler, Umlaute, Stemming. Sofort, unabhängig vom
   Rest.
2. **Abschnittstabelle + Indexierung**, zunächst nur mit Volltext befüllt. Damit
   ist der Weg gebaut und die Rechteprüfung erprobt, bevor Vektoren im Spiel
   sind.
3. **Stufe 1** — statische Vektoren, Verschmelzung mit BM25. Messen, ob es
   reicht.
4. **Stufe 2** nur, wenn Schritt 3 nachweislich zu schwach ist — und dann über
   wazero.

Der Sprung von 2 auf 3 ist klein, wenn 2 richtig gebaut ist: es kommt eine
Spalte hinzu und eine Funktion, die sie füllt.
