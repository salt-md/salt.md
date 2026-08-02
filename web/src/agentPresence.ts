import { useEffect, useState } from 'react';
import { api } from './api';

// Who says they are working on which page right now.
//
// One fetch for the whole app, shared by every component that wants it: the
// topbar of the open page and every card of an open board would otherwise each
// ask on every event. The server pushes a content-free "presence" signal and we
// refetch through a route that checks permissions per page — the event bus
// reaches every browser on the instance, so it may never carry a page title.

export interface AgentWork {
  pageId: string;
  pageTitle: string;
  agent: string; // a known key, or "generic"
  label: string; // what it calls itself
  note: string;
  accountName: string;
  startedAt: string;
  lastSeen: string;
  expectedMinutes: number;
}

let cache: AgentWork[] = [];
let freshSeconds = 600;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;

function load(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = api
    .presence()
    .then((r) => {
      cache = r.working ?? [];
      freshSeconds = r.freshSeconds ?? 600;
      listeners.forEach((f) => f());
    })
    .catch(() => {})
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Everything currently announced, for one page or for all of them. */
export function useAgentPresence(pageId?: string): AgentWork[] {
  const [, bump] = useState(0);
  useEffect(() => {
    const onChange = () => bump((n) => n + 1);
    listeners.add(onChange);
    void load();
    const onEvent = () => void load();
    window.addEventListener('salt:presence', onEvent);
    // A minute tick, so "last seen 4 min ago" ages on screen without anyone
    // writing anything. Cheap: it re-renders a badge, it does not fetch.
    const tick = window.setInterval(onChange, 60_000);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener('salt:presence', onEvent);
      window.clearInterval(tick);
    };
  }, []);
  return pageId ? cache.filter((w) => w.pageId === pageId) : cache;
}

/** Fresh means "called something in the last few minutes", not "alive". */
export function isFresh(w: AgentWork): boolean {
  const seen = Date.parse(w.lastSeen);
  return isFinite(seen) && Date.now() - seen < freshSeconds * 1000;
}

export function minutesSince(iso: string): number {
  const t = Date.parse(iso);
  if (!isFinite(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 60_000));
}

// A colour per agent so two of them are told apart at a glance. Deliberately
// NOT brand logos: shipping somebody else's mark is a decision for its owner,
// not a detail of this feature. Swapping these for real marks later is this one
// map and nothing else.
const AGENT_COLORS: Record<string, string> = {
  claude: '#c96442',
  chatgpt: '#10a37f',
  copilot: '#6e7681',
  cursor: '#7c6cf5',
  gemini: '#4285f4',
  generic: '#787774',
};

export function agentColor(agent: string): string {
  return AGENT_COLORS[agent] ?? AGENT_COLORS.generic;
}

/** What to write on the badge: the name it gave, else the key it matched. */
export function agentName(w: AgentWork): string {
  return w.label.trim() || w.agent;
}
