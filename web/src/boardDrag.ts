import { useCallback, useEffect, useRef, useState } from 'react';

// Zeiger-basiertes Ziehen fuers Kanban-Board.
//
// Vorher lag der native HTML5-Drag darunter (`draggable`), und der fuehlt sich
// aus mehreren Gruenden schlecht an: der Browser malt eine blasse Geisterkopie,
// es gibt keine Anzeige, WO die Karte landet, kein Auto-Scroll, und auf Touch
// funktioniert er gar nicht — dafuer gab es extra ein ⋯-Menue.
//
// Diese Fassung nutzt Pointer-Events (Maus und Finger in einem): eine echte
// schwebende Karte folgt dem Zeiger, die Zielspalte hebt sich hervor, und beim
// Loslassen wird verschoben. Die Trefferpruefung laeuft ueber `data-col` am
// Spalten-Element statt ueber durchgereichte Refs — das haelt den Aufrufer
// schlank.

export interface DragState {
  rowId: string;
  fromCol: string;
  title: string;
  width: number;
  // aktuelle Zeigerposition und Griffversatz (wo in der Karte angefasst wurde)
  x: number;
  y: number;
  dx: number;
  dy: number;
  over: string | null; // Spalte unter dem Zeiger
}

const START_THRESHOLD = 5; // px, bevor aus einem Klick ein Ziehen wird

// Auf dem Finger gilt etwas anderes. Fuenf Pixel sind beim Scrollen sofort
// ueberschritten — die Karte blieb am Finger haengen, statt dass das Board
// scrollte. Deshalb: erst halten, dann ziehen. Wer vorher wischt, scrollt.
const TOUCH_HOLD_MS = 320;
// Wieviel Wackeln waehrend des Haltens noch als "Halten" durchgeht. Darueber
// war es eine Wischbewegung, und der Zug wird gar nicht erst scharf gestellt.
const TOUCH_HOLD_SLOP = 10;

export function useBoardDrag(onMove: (rowId: string, toCol: string) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  // Welche Karte nach dem Halten "scharf" ist, aber noch nicht bewegt wurde.
  // Auf dem iPhone gibt es kein navigator.vibrate — ohne ein sichtbares
  // Signal passiert nach dem Halten bis zur ersten Bewegung gar nichts, und
  // niemand weiss, ob die Karte jetzt am Finger haengt.
  const [armedRow, setArmedRow] = useState<string | null>(null);

  // Lebende Daten fuer die Fenster-Listener, damit die nicht bei jedem
  // Positions-Update neu gebunden werden muessen.
  const live = useRef<{
    rowId: string;
    fromCol: string;
    title: string;
    width: number;
    dx: number;
    dy: number;
    startX: number;
    startY: number;
    started: boolean;
    over: string | null;
    touch: boolean;
    // armed: beim Finger erst nach TOUCH_HOLD_MS true. Vorher gehoert jede
    // Bewegung dem Scrollen.
    armed: boolean;
    holdTimer: number | null;
  } | null>(null);
  // Ob gerade wirklich gezogen wurde — unterscheidet Klick (navigieren) von
  // Ziehen (verschieben). Als Ref, weil der pointerup-Handler es sofort braucht.
  const draggedRef = useRef(false);

  const colUnder = (x: number, y: number): string | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const col = (el as HTMLElement).closest?.('[data-col]');
      if (col) return col.getAttribute('data-col');
    }
    return null;
  };

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const l = live.current;
      if (!l) return;
      const moved = Math.hypot(e.clientX - l.startX, e.clientY - l.startY);
      if (!l.started) {
        if (l.touch && !l.armed) {
          // Noch im Haltefenster: wer wischt, will scrollen. Den Zug ganz
          // aufgeben, sonst schnappt die Karte spaeter mitten im Scrollen zu.
          if (moved > TOUCH_HOLD_SLOP) {
            if (l.holdTimer) clearTimeout(l.holdTimer);
            live.current = null;
            setArmedRow(null);
          }
          return;
        }
        if (moved < START_THRESHOLD) return;
        l.started = true;
        draggedRef.current = true;
      }
      l.over = colUnder(e.clientX, e.clientY);
      setDrag({
        rowId: l.rowId,
        fromCol: l.fromCol,
        title: l.title,
        width: l.width,
        x: e.clientX,
        y: e.clientY,
        dx: l.dx,
        dy: l.dy,
        over: l.over,
      });

      // Am oberen/unteren Rand einer Spalte mitscrollen, damit man Karten auch
      // in lange Listen ziehen kann, ohne loszulassen.
      const cards = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement)?.closest?.(
        '.board-cards',
      ) as HTMLElement | null;
      if (cards) {
        const r = cards.getBoundingClientRect();
        if (e.clientY - r.top < 40) cards.scrollTop -= 12;
        else if (r.bottom - e.clientY < 40) cards.scrollTop += 12;
      }
    };

    const onPointerUp = () => {
      const l = live.current;
      if (l?.holdTimer) clearTimeout(l.holdTimer);
      live.current = null;
      setDrag(null);
      setArmedRow(null);
      if (l && l.started && l.over && l.over !== l.fromCol) {
        onMove(l.rowId, l.over);
      }
      // draggedRef bleibt bis zum naechsten click stehen, damit der
      // Klick-Handler der Karte die Navigation unterdruecken kann.
    };

    // Sobald wirklich gezogen wird, darf die Seite nicht mitscrollen. Ueber
    // `touch-action` geht das nicht: der Wert wird beim Beginn der Geste
    // ausgewertet, spaeteres Aendern wirkt auf die laufende Geste nicht mehr.
    // Also der harte Weg — passive: false, damit preventDefault erlaubt ist.
    const onTouchMove = (e: TouchEvent) => {
      if (live.current?.started) e.preventDefault();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [onMove]);

  const startDrag = useCallback(
    (e: React.PointerEvent, rowId: string, fromCol: string, title: string) => {
      // Nur linke Maustaste / Finger, und nicht auf einem Bedienelement der
      // Karte (⋯-Menue, Auswahl-Chip) — dort will man klicken, nicht ziehen.
      if (e.button !== 0) return;
      if ((e.target as Element).closest?.('.card-move, .card-prop-edit, a, button')) return;
      const card = (e.currentTarget as HTMLElement).getBoundingClientRect();
      draggedRef.current = false;
      const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
      live.current = {
        rowId,
        fromCol,
        title,
        width: card.width,
        dx: e.clientX - card.left,
        dy: e.clientY - card.top,
        startX: e.clientX,
        startY: e.clientY,
        started: false,
        over: fromCol,
        touch,
        armed: !touch, // Maus: sofort scharf. Finger: erst nach dem Halten.
        holdTimer: null,
      };
      if (touch) {
        const l = live.current;
        l.holdTimer = window.setTimeout(() => {
          if (live.current !== l) return;
          l.armed = true;
          setArmedRow(l.rowId);
          navigator.vibrate?.(12);
        }, TOUCH_HOLD_MS);
      }
    },
    [],
  );

  // Der Karten-Klick fragt das ab: wurde gerade gezogen, NICHT navigieren.
  const consumeClick = useCallback(() => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return true; // Klick gehoerte zu einem Ziehen — schlucken
    }
    return false;
  }, []);

  return { drag, armedRow, startDrag, consumeClick };
}
