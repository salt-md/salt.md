import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';

// Thin realtime provider for Salt.md's relay protocol (see server/collab.go).
// The server replays the persisted doc, then relays updates. It never
// interprets CRDT data; compaction happens via {"snapshotRequest":seq}.

const FRAME_UPDATE = 0;
const FRAME_AWARENESS = 1;
const FRAME_SNAPSHOT = 2;

export class SaltProvider {
  doc: Y.Doc;
  awareness: Awareness;
  synced = false;
  isNew = false;

  readonly pageId: string;

  private ws: WebSocket | null = null;
  private closed = false;
  private everSynced = false;
  private reconnectAttempt = 0;
  private onSynced: (isNew: boolean) => void;
  private onReset: () => void;
  // Dead-socket watchdog. Proxies kill idle WebSockets without telling the
  // browser (half-open TCP): the socket looks OPEN but nothing ever arrives
  // again — the exact "I only see his edits after a reload" bug. The server
  // sends {"ping":true} every 20s, so a healthy socket is never silent for
  // long; if it is, we force-close and let the reconnect logic take over.
  private lastMsg = 0;
  private connectStarted = 0;
  private watchdog: ReturnType<typeof setInterval>;

  constructor(pageId: string, onSynced: (isNew: boolean) => void, onReset: () => void) {
    this.pageId = pageId;
    this.onSynced = onSynced;
    this.onReset = onReset;
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      this.send(FRAME_UPDATE, update);
    });
    this.awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        // Nur den EIGENEN Client announcen. 'update' feuert auch für
        // angewendete REMOTE-Einträge (z. B. die ~15s-Renewals der anderen);
        // ohne Filter würden fremde clientIDs zurück an den Server geechot,
        // der sie dieser Verbindung zuschriebe — und beim Trennen die
        // Presence LEBENDER Nutzer wegräumen würde.
        const me = this.doc.clientID;
        const ids = added.concat(updated, removed).filter((id) => id === me);
        if (ids.length === 0) return;
        this.send(FRAME_AWARENESS, encodeAwarenessUpdate(this.awareness, ids));
      },
    );
    this.watchdog = setInterval(() => {
      const ws = this.ws;
      if (!ws) return;
      const now = Date.now();
      if (ws.readyState === WebSocket.OPEN && now - this.lastMsg > 55_000) {
        this.dropConnection(ws); // silent for >2 missed server pings: presumed dead
      } else if (ws.readyState === WebSocket.CONNECTING && now - this.connectStarted > 15_000) {
        this.dropConnection(ws); // stuck handshake (broken proxy); aborts and retries
      }
    }, 10_000);
    this.connect();
  }

  // Gibt einen für tot befundenen Socket sofort auf. Nur ws.close() reicht
  // nicht: Der Close-Handshake gegen einen halbtoten Peer läuft je nach
  // Browser 20–60s, bevor onclose feuert — so lange wäre der Nutzer weiter
  // offline. Deshalb: Handler abklemmen, schließen, direkt neu verbinden.
  private dropConnection(ws: WebSocket) {
    ws.onclose = null;
    ws.onmessage = null;
    ws.onopen = null;
    try {
      ws.close();
    } catch {
      /* nichts — der Socket ist ohnehin verloren */
    }
    this.handleClosed(null);
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/collab/${this.pageId}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.connectStarted = Date.now();
    this.lastMsg = Date.now();

    ws.onopen = () => {
      this.lastMsg = Date.now();
    };

    ws.onmessage = (e: MessageEvent) => {
      this.lastMsg = Date.now();
      if (typeof e.data === 'string') {
        const msg = JSON.parse(e.data) as Record<string, unknown>;
        if ('ping' in msg) {
          return; // keepalive traffic; receiving it is all the watchdog needs
        }
        if ('isNew' in msg) {
          // isNew only counts for the very first sync; after a reconnect the
          // local doc already has state and must not be re-seeded.
          if (!this.everSynced) this.isNew = msg.isNew === true;
        } else if ('synced' in msg) {
          this.synced = true;
          this.reconnectAttempt = 0; // a clean sync resets the backoff
          if (this.everSynced) {
            // Reconnect: push local state so offline edits reach the server.
            this.send(FRAME_UPDATE, Y.encodeStateAsUpdate(this.doc));
          }
          const first = !this.everSynced;
          this.everSynced = true;
          if (first) this.onSynced(this.isNew);
          // Re-announce presence after (re)connects. Der Server hat beim Tod
          // der alten Verbindung unser Removal mit clock+1 broadcastet — ein
          // schlichtes Re-Announce (gleiche Clock) würde von allen Peers als
          // veraltet verworfen und wir blieben bis zu 30s unsichtbar. Zweimal
          // setLocalState bumpt die Clock sicher am Removal vorbei; jeder Set
          // feuert den update-Listener, der das Announce sendet.
          const st = this.awareness.getLocalState();
          if (st !== null) {
            this.awareness.setLocalState(st);
            this.awareness.setLocalState(st);
          } else {
            this.send(
              FRAME_AWARENESS,
              encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
            );
          }
        } else if ('snapshotRequest' in msg) {
          const seq = BigInt(msg.snapshotRequest as number);
          const snap = Y.encodeStateAsUpdate(this.doc);
          const buf = new Uint8Array(9 + snap.length);
          buf[0] = FRAME_SNAPSHOT;
          new DataView(buf.buffer).setBigUint64(1, seq);
          buf.set(snap, 9);
          if (ws.readyState === WebSocket.OPEN) ws.send(buf);
        }
        return;
      }
      const data = new Uint8Array(e.data as ArrayBuffer);
      if (data.length < 1) return;
      if (data[0] === FRAME_UPDATE) {
        Y.applyUpdate(this.doc, data.subarray(1), 'remote');
      } else if (data[0] === FRAME_AWARENESS) {
        applyAwarenessUpdate(this.awareness, data.subarray(1), 'remote');
      }
    };

    ws.onclose = (e: CloseEvent) => this.handleClosed(e);
  }

  // Gemeinsamer Abgang für onclose und den Watchdog-Kill (dort ohne Event).
  private handleClosed(e: CloseEvent | null) {
    this.synced = false;
    // Peers from the dead connection are unknowable now; drop them locally
    // instead of showing stale avatars. The server replays live presence
    // on reconnect, so real peers reappear immediately.
    removeAwarenessStates(
      this.awareness,
      [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID),
      'disconnect',
    );
    if (this.closed) return;
    if (e?.code === 4001) {
      // Server-side doc was reset (API write): local state is stale.
      this.onReset();
      return;
    }
    // Exponential backoff with full jitter, capped at 30s, so a flapping or
    // downed server isn't hammered by every open tab every 1.5s.
    const base = Math.min(30000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt++;
    const delay = Math.round(base / 2 + Math.random() * (base / 2));
    setTimeout(() => {
      if (!this.closed) this.connect();
    }, delay);
  }

  private send(type: number, payload: Uint8Array) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const buf = new Uint8Array(1 + payload.length);
    buf[0] = type;
    buf.set(payload, 1);
    this.ws.send(buf);
  }

  destroy() {
    if (this.closed) return; // StrictMode double-mount / repeated cleanup
    this.closed = true;
    clearInterval(this.watchdog);
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');
    this.ws?.close();
    this.doc.destroy();
  }
}
