import { useEffect, useState } from 'react';
import { api } from '../api';
import Portal from './Portal';
import { useExclusiveModal } from '../modal';
import { toast } from '../toast';
import type { Workspace } from '../types';
import { Bot, Check, Copy } from 'lucide-react';

// „Agent verbinden" (Welle 44): Salt.md ist AI-nativ — jeder Agent spricht
// über den eingebauten MCP-Server mit dem Workspace. Dieses Modal macht das
// Verbinden zum Ein-Minuten-Setup: Token mit einem Klick erzeugen, Agent in
// der Galerie wählen, fertigen Config-Schnipsel kopieren.

interface AgentDef {
  id: string;
  name: string;
  logo: React.ReactNode;
  hint: string;
  snippet: (url: string, token: string) => string;
}

const TOKEN_PH = '<DEIN-TOKEN>';

// Ein Link für alles: der Token steckt in der URL (…/mcp/<token>). Damit
// funktionieren auch Clients, die NUR ein URL-Feld haben und keine Header
// setzen können (claude.ai/Desktop-Connectors, ChatGPT, …).
const mcpURL = (url: string, token: string) => `${url}/mcp/${token}`;

// Generischer mcpServers-Block — dank Token-in-URL ohne headers-Gefrickel.
const mcpJSON = (url: string, token: string) =>
  JSON.stringify({ mcpServers: { salt: { url: mcpURL(url, token) } } }, null, 2);

// Echte Logos von selfh.st/icons, lokal gebündelt (web/public/agents/).
// mono = schwarzes Logo → im Dark Mode invertiert.
const img = (file: string, mono = false) => (
  <img className={'agent-img' + (mono ? ' agent-img--mono' : '')} src={'/agents/' + file} alt="" />
);

const AGENTS: AgentDef[] = [
  {
    id: 'claude-app',
    name: 'Claude (App & Web)',
    logo: img('claude.svg'),
    hint: 'Einstellungen → Connectors → „Add custom connector" — nur die URL einfügen.',
    snippet: (url, token) => mcpURL(url, token),
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    logo: img('claude.svg'),
    hint: 'Ein Befehl im Terminal — fertig.',
    snippet: (url, token) => `claude mcp add --transport http salt ${mcpURL(url, token)}`,
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    logo: img('chatgpt.svg'),
    hint: 'Settings → Connectors (Developer Mode) — URL einfügen.',
    snippet: (url, token) => mcpURL(url, token),
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    logo: img('openai.svg', true),
    hint: 'In ~/.codex/config.toml eintragen.',
    snippet: (url, token) => `[mcp_servers.salt]
url = "${mcpURL(url, token)}"`,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    logo: (
      // Kein selfh.st-Icon vorhanden — neutraler Würfel in currentColor.
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <path fill="currentColor" d="M12 2l9 5v10l-9 5-9-5V7z" opacity="0.9" />
        <path fill="var(--bg)" d="M12 6.2L17.5 9 12 11.8 6.5 9z" opacity="0.85" />
      </svg>
    ),
    hint: 'In .cursor/mcp.json (Projekt) oder ~/.cursor/mcp.json (global).',
    snippet: (url, token) => mcpJSON(url, token),
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    logo: img('openclaw.svg'),
    hint: 'Als MCP-Server in der OpenClaw-Konfiguration hinterlegen.',
    snippet: (url, token) => mcpJSON(url, token),
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    logo: img('hermes-agent.png'),
    hint: 'Standard-mcpServers-Eintrag in der Agent-Konfiguration.',
    snippet: (url, token) => mcpJSON(url, token),
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    logo: img('google-gemini.svg'),
    hint: 'In ~/.gemini/settings.json eintragen.',
    snippet: (url, token) =>
      JSON.stringify({ mcpServers: { salt: { httpUrl: mcpURL(url, token) } } }, null, 2),
  },
  {
    id: 'other',
    name: 'Anderer Agent',
    logo: <Bot size={26} />,
    hint: 'Jeder MCP-fähige Client (Streamable HTTP).',
    snippet: (url, token) => `MCP-URL (Token integriert):  ${mcpURL(url, token)}

Alternativ klassisch mit Header:
  Endpoint:  ${url}/mcp
  Header:    Authorization: Bearer ${token}

REST-API:  ${url}/api  (gleicher Bearer-Token)`,
  },
];

export default function AgentConnectModal({
  workspaces,
  currentWs,
  onClose,
}: {
  workspaces: Workspace[];
  currentWs: string;
  onClose: () => void;
}) {
  useExclusiveModal(onClose);
  const [token, setToken] = useState('');
  const [manual, setManual] = useState('');
  const [scope, setScope] = useState<'write' | 'read'>('write');
  const [wsScope, setWsScope] = useState<'current' | 'all'>('current');
  const [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState<AgentDef>(AGENTS[0]);
  const [copied, setCopied] = useState(false);

  // Prefer the configured public address (Domain/Tunnel) over whatever address
  // this browser happens to use — cloud agents must reach the URL from outside.
  const [url, setUrl] = useState(window.location.origin);
  useEffect(() => {
    api
      .publicBase()
      .then((r) => r.base && setUrl(r.base.replace(/\/$/, '')))
      .catch(() => {});
  }, []);
  const effToken = token || manual.trim() || TOKEN_PH;
  const wsName = workspaces.find((w) => w.id === currentWs)?.name ?? 'diesem Workspace';

  const createToken = async () => {
    setBusy(true);
    try {
      const chosen = wsScope === 'current' && currentWs ? [currentWs] : [];
      const res = await api.createToken('agent', scope, chosen);
      setToken(res.token);
      toast('Token erstellt — wird nur einmal angezeigt');
    } catch (e) {
      toast((e as Error).message || 'Token konnte nicht erstellt werden');
    } finally {
      setBusy(false);
    }
  };

  const snippet = agent.snippet(url, effToken);
  const copy = () => {
    void navigator.clipboard?.writeText(snippet);
    setCopied(true);
    toast('Setup kopiert');
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Portal>
      <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="dialog wide agent-dialog" role="dialog" aria-modal="true" aria-label="Agent verbinden">
          <h2>
            <Bot size={22} style={{ verticalAlign: '-4px' }} /> Agent verbinden
          </h2>
          <p className="dialog-hint">
            Salt.md ist AI-nativ: Der eingebaute MCP-Server lässt jeden Agenten Seiten lesen,
            schreiben, durchsuchen und Datenbanken pflegen. <b>Ein Link reicht</b> — der Token
            steckt in der URL, Header-Konfiguration braucht es nicht mehr. Behandle den Link
            deshalb wie ein Passwort.
          </p>

          <div className="agent-token">
            {token ? (
              <div className="agent-token-fresh">
                <code onClick={() => { void navigator.clipboard?.writeText(token); toast('Token kopiert'); }}>{token}</code>
                <span className="dialog-hint">Nur jetzt sichtbar — ist unten schon eingesetzt.</span>
              </div>
            ) : (
              <>
                <div className="agent-token-row">
                  <select className="prop-select" value={scope} onChange={(e) => setScope(e.target.value as 'write' | 'read')}>
                    <option value="write">Lesen &amp; Schreiben</option>
                    <option value="read">Nur lesen</option>
                  </select>
                  <select className="prop-select" value={wsScope} onChange={(e) => setWsScope(e.target.value as 'current' | 'all')}>
                    <option value="current">Nur „{wsName}"</option>
                    <option value="all">Alle Workspaces</option>
                  </select>
                  <button className="btn primary" disabled={busy} onClick={() => void createToken()}>
                    Token erstellen
                  </button>
                </div>
                <input
                  className="prop-input"
                  placeholder="… oder vorhandenen Token hier einsetzen"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                />
              </>
            )}
          </div>

          <div className="agent-grid">
            {AGENTS.map((a) => (
              <button
                key={a.id}
                className={'agent-card' + (agent.id === a.id ? ' active' : '')}
                onClick={() => setAgent(a)}
              >
                <span className="agent-logo">{a.logo}</span>
                <span className="agent-name">{a.name}</span>
              </button>
            ))}
          </div>

          <div className="conf-block agent-snippet">
            <div className="conf-head">
              <span>{agent.name} — {agent.hint}</span>
              <button className="btn-sm" onClick={copy}>
                {copied ? <Check size={13} /> : <Copy size={13} />} Kopieren
              </button>
            </div>
            <pre>
              <code>{snippet}</code>
            </pre>
          </div>

          {effToken === TOKEN_PH && (
            <p className="dialog-hint settings-hint">
              Oben Token erstellen (oder einsetzen) — er wird automatisch in den Schnipsel übernommen.
            </p>
          )}
          {url.startsWith('http://') && !/^http:\/\/(localhost|127\.)/.test(url) && (
            <p className="dialog-hint settings-hint pa-warn">
              ⚠ Cloud-Agents (z.&nbsp;B. claude.ai) erreichen <code>{url}</code> nicht — dafür die
              Instanz öffentlich machen (Instanz-Einstellungen → Domain &amp; Proxy) und über die
              öffentliche URL verbinden. Lokale CLIs im selben Netz funktionieren direkt.
            </p>
          )}

          <button className="btn dialog-close" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </Portal>
  );
}
