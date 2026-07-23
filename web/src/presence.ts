import { useEffect, useState } from 'react';

// Wer ist sonst noch auf dieser Seite.
//
// Die Angabe entsteht im CollabEditor (Yjs-Awareness), angezeigt wird sie eine
// Ebene darüber in der Kopfzeile. Statt sie durch mehrere Komponenten zu
// reichen, liegt sie in diesem kleinen Speicher — dieselbe Rolle wie
// blockContext für den Datenbank-Block, nur ohne Context, weil hier niemand
// dazwischen etwas davon wissen muss.
//
// Bis W90 wurde die Präsenz zwar gesendet, aber NIRGENDS angezeigt: man konnte
// zu zweit im selben Dokument tippen, ohne es zu bemerken.

export interface Peer {
  name: string;
  color: string;
  avatar?: string;
}

const peersByPage = new Map<string, Peer[]>();
const listeners = new Set<() => void>();

export function setPeers(pageId: string, peers: Peer[]) {
  const prev = peersByPage.get(pageId);
  // Awareness feuert bei jeder Cursorbewegung. Ohne diesen Vergleich würde die
  // Kopfzeile bei jedem Tastendruck der anderen neu zeichnen.
  if (
    prev &&
    prev.length === peers.length &&
    prev.every((p, i) => p.name === peers[i].name && p.avatar === peers[i].avatar)
  ) {
    return;
  }
  peersByPage.set(pageId, peers);
  listeners.forEach((fn) => fn());
}

export function clearPeers(pageId: string) {
  if (peersByPage.delete(pageId)) listeners.forEach((fn) => fn());
}

export function usePeers(pageId: string): Peer[] {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return peersByPage.get(pageId) ?? [];
}
