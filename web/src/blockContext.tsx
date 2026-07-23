import { createContext, useContext } from 'react';
import type { PageMeta } from './types';

// Eigene Blöcke rendern INNERHALB des Editors, haben aber keinen Zugriff auf
// dessen Props. Der Datenbank-Block braucht genau das: die Seitenliste (um eine
// Datenbank auszuwählen und ihren Titel zu zeigen), die Tag-Farben und die
// Navigation. Ein Context ist dafür der saubere Weg — Modulzustand wäre
// unsichtbar gekoppelt und würde bei zwei offenen Dokumenten kollidieren.

export interface BlockCtx {
  pagesById: Map<string, PageMeta>;
  tagColors: Record<string, string>;
  onNavigate: (id: string | null) => void;
  onPagesChanged: () => void;
}

const empty: BlockCtx = {
  pagesById: new Map(),
  tagColors: {},
  onNavigate: () => {},
  onPagesChanged: () => {},
};

export const BlockContext = createContext<BlockCtx>(empty);
export const useBlockCtx = () => useContext(BlockContext);
