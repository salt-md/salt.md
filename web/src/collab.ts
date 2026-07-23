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
        const ids = added.concat(updated, removed);
        this.send(FRAME_AWARENESS, encodeAwarenessUpdate(this.awareness, ids));
      },
    );
    this.connect();
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/collab/${this.pageId}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data === 'string') {
        const msg = JSON.parse(e.data) as Record<string, unknown>;
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
          // Re-announce presence after (re)connects.
          this.send(
            FRAME_AWARENESS,
            encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
          );
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

    ws.onclose = (e: CloseEvent) => {
      this.synced = false;
      if (this.closed) return;
      if (e.code === 4001) {
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
    };
  }

  private send(type: number, payload: Uint8Array) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const buf = new Uint8Array(1 + payload.length);
    buf[0] = type;
    buf.set(payload, 1);
    this.ws.send(buf);
  }

  destroy() {
    this.closed = true;
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');
    this.ws?.close();
    this.doc.destroy();
  }
}
