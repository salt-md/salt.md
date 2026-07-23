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

export function useBoardDrag(onMove: (rowId: string, toCol: string) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);

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
      if (!l.started) {
        if (Math.hypot(e.clientX - l.startX, e.clientY - l.startY) < START_THRESHOLD) return;
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
      live.current = null;
      setDrag(null);
      if (l && l.started && l.over && l.over !== l.fromCol) {
        onMove(l.rowId, l.over);
      }
      // draggedRef bleibt bis zum naechsten click stehen, damit der
      // Klick-Handler der Karte die Navigation unterdruecken kann.
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
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
      };
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

  return { drag, startDrag, consumeClick };
}
