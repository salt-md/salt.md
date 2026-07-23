import { useEffect, useState } from 'react';
import { api } from '../api';
import Portal from './Portal';
import { useExclusiveModal } from '../modal';
import { toast } from '../toast';

type Info = Awaited<ReturnType<typeof api.adminInfo>>;

const fmtBytes = (n: number) => {
  if (n >= 1 << 30) return (n / (1 << 30)).toFixed(2) + ' GB';
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
};

const fmtUptime = (sec: number) => {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};

// A read-only config snippet with a copy button.
function ConfBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="conf-block">
      <div className="conf-head">
        <span>{title}</span>
        <button
          className="btn-sm"
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            toast('Kopiert');
          }}
        >
          Kopieren
        </button>
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
}

// Instance-wide settings (admin only), grouped in tabs: general limits,
// registration, SMTP, reverse-proxy setup (Caddy / Cloudflare / nginx with
// generated configs) and maintenance (backup, instance info).
export function AdminSettingsModal({ onClose }: { onClose: () => void }) {
  useExclusiveModal(onClose);
  const [s, setS] = useState<Record<string, string>>({});
  const [trustProxy, setTrustProxy] = useState(false);
  const [allowUserWs, setAllowUserWs] = useState(true);
  const [passSet, setPassSet] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'allgemein' | 'zugang' | 'email' | 'proxy' | 'wartung'>('allgemein');
  const [info, setInfo] = useState<Info | null>(null);
  const [upstream, setUpstream] = useState(window.location.host || '127.0.0.1:80');
  const [httpsEnabled, setHttpsEnabled] = useState(false);
  const [pa, setPa] = useState<Awaited<ReturnType<typeof api.publicAccess>> | null>(null);
  const [tunnelToken, setTunnelToken] = useState('');
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [oauthSet, setOauthSet] = useState({ google: false, ms: false });
  const [mail, setMail] = useState({ provider: '', address: '' });
  const [mailBusy, setMailBusy] = useState(false);

  useEffect(() => {
    void api
      .getSettings()
      .then((v) => {
        setS({
          instanceName: v.instanceName,
          signupMode: v.signupMode,
          allowedDomains: v.allowedDomains,
          smtpHost: v.smtpHost,
          smtpPort: v.smtpPort,
          smtpUser: v.smtpUser,
          smtpFrom: v.smtpFrom,
          publicBaseUrl: v.publicBaseUrl,
          smtpPass: '',
          maxUploadMb: String(v.maxUploadMb),
          trashDays: String(v.trashDays),
          sessionDays: String(v.sessionDays),
          httpsDomain: v.httpsDomain,
          mailFrom: v.mailFrom,
          googleClientId: v.googleClientId,
          googleClientSecret: '',
          msClientId: v.msClientId,
          msClientSecret: '',
        });
        setTrustProxy(v.trustProxy);
        setAllowUserWs(v.allowUserWorkspaces !== false);
        setHttpsEnabled(v.httpsEnabled);
        setOauthSet({ google: v.googleSecretSet, ms: v.msSecretSet });
        setMail({ provider: v.mailProvider, address: v.mailAddress });
        setPassSet(v.smtpPassSet);
        setLoaded(true);
      })
      .catch((e) => setLoadErr((e as Error).message || 'Laden fehlgeschlagen'));
  }, []);

  // Instance info lazily when the Wartung tab opens.
  useEffect(() => {
    if (tab === 'wartung' && !info) void api.adminInfo().then(setInfo).catch(() => {});
  }, [tab, info]);

  // Live tunnel status while the Domain & Proxy or Zugang tab is open (the
  // OAuth cards derive the public redirect URI from a running tunnel).
  useEffect(() => {
    if (tab !== 'proxy' && tab !== 'zugang') return;
    let alive = true;
    const load = () => void api.publicAccess().then((v) => alive && setPa(v)).catch(() => {});
    load();
    const iv = window.setInterval(load, 2500);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, [tab]);

  const tunnel = async (action: string, token?: string) => {
    setTunnelBusy(true);
    try {
      await api.tunnelAction(action, token);
      setPa(await api.publicAccess());
      if (action === 'start-token') setTunnelToken('');
    } catch (e) {
      toast((e as Error).message || 'Tunnel-Aktion fehlgeschlagen');
    } finally {
      setTunnelBusy(false);
    }
  };

  const set = (k: string, v: string) => setS((p) => ({ ...p, [k]: v }));
  const mailTest = async () => {
    setMailBusy(true);
    try {
      const r = await api.mailTest();
      toast('Test-Mail an ' + r.to + ' verschickt ✓');
    } catch (e) {
      toast((e as Error).message || 'Test fehlgeschlagen');
    } finally {
      setMailBusy(false);
    }
  };
  const mailDisconnect = async () => {
    try {
      await api.mailDisconnect();
      setMail({ provider: '', address: '' });
      toast('Mail-Verbindung getrennt');
    } catch (e) {
      toast((e as Error).message || 'Trennen fehlgeschlagen');
    }
  };
  const save = async () => {
    const num = (k: string, min: number, max: number) => {
      const n = parseInt(s[k], 10);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
    };
    try {
      await api.putSettings({
        instanceName: s.instanceName,
        signupMode: s.signupMode,
        allowedDomains: s.allowedDomains,
        smtpHost: s.smtpHost,
        smtpPort: s.smtpPort,
        smtpUser: s.smtpUser,
        smtpFrom: s.smtpFrom,
        smtpPass: s.smtpPass,
        publicBaseUrl: s.publicBaseUrl,
        trustProxy,
        allowUserWorkspaces: allowUserWs,
        maxUploadMb: num('maxUploadMb', 1, 2048),
        trashDays: num('trashDays', 0, 3650),
        sessionDays: num('sessionDays', 1, 365),
        httpsDomain: s.httpsDomain,
        httpsEnabled,
        mailFrom: s.mailFrom,
        googleClientId: s.googleClientId,
        googleClientSecret: s.googleClientSecret,
        msClientId: s.msClientId,
        msClientSecret: s.msClientSecret,
      });
      toast('Einstellungen gespeichert');
      onClose();
    } catch (e) {
      toast((e as Error).message || 'Speichern fehlgeschlagen');
    }
  };

  // Domain for the generated proxy configs, derived from the public base URL.
  const domain = (() => {
    try {
      return new URL(s.publicBaseUrl || '').host || 'salt.example.com';
    } catch {
      return 'salt.example.com';
    }
  })();

  const caddyConf = `${domain} {
	reverse_proxy ${upstream}
}`;

  const cloudflaredConf = `# 1) Tunnel anlegen (einmalig):
#    cloudflared tunnel login
#    cloudflared tunnel create salt
#    cloudflared tunnel route dns salt ${domain}
# 2) ~/.cloudflared/config.yml:
tunnel: salt
credentials-file: /root/.cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: ${domain}
    service: http://${upstream}
  - service: http_status:404
# 3) Starten / als Dienst:
#    cloudflared tunnel run salt
#    (oder: cloudflared service install)`;

  const nginxConf = `server {
	listen 443 ssl http2;
	server_name ${domain};
	client_max_body_size ${s.maxUploadMb || '50'}m;

	location / {
		proxy_pass http://${upstream};
		proxy_set_header Host $host;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		# WebSockets (Live-Collaboration):
		proxy_http_version 1.1;
		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection "upgrade";
		proxy_read_timeout 3600s;
	}
}`;

  const TABS: { id: typeof tab; label: string }[] = [
    { id: 'allgemein', label: 'Allgemein' },
    { id: 'zugang', label: 'Zugang' },
    { id: 'email', label: 'E-Mail' },
    { id: 'proxy', label: 'Domain & Proxy' },
    { id: 'wartung', label: 'Wartung' },
  ];

  return (
    <Portal>
      <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="dialog wide settings-dialog" role="dialog" aria-modal="true" aria-label="Instanz-Einstellungen">
          <h2>Instanz-Einstellungen</h2>
          {loadErr ? (
            <div className="login-error">{loadErr}</div>
          ) : !loaded ? (
            <div className="dialog-hint">Lädt…</div>
          ) : (
            <>
              <div className="settings-tabs">
                {TABS.map((t) => (
                  <button key={t.id} className={'view-tab' + (tab === t.id ? ' active' : '')} onClick={() => setTab(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="settings-grid settings-body">
                {tab === 'allgemein' && (
                  <>
                    <label>Name der Instanz (Login-Seite & Titel)</label>
                    <input className="prop-input" placeholder="z. B. VIICO Notes" value={s.instanceName} onChange={(e) => set('instanceName', e.target.value)} />
                    <label>Öffentliche Basis-URL (für Links, Mails, Kalender)</label>
                    <input className="prop-input" placeholder="https://notes.firma.de" value={s.publicBaseUrl} onChange={(e) => set('publicBaseUrl', e.target.value)} />
                    <label>Max. Dateigröße pro Upload (MB)</label>
                    <input className="prop-input" type="number" min={1} max={2048} value={s.maxUploadMb} onChange={(e) => set('maxUploadMb', e.target.value)} />
                    <label>Papierkorb automatisch leeren nach (Tagen, 0 = nie)</label>
                    <input className="prop-input" type="number" min={0} max={3650} value={s.trashDays} onChange={(e) => set('trashDays', e.target.value)} />
                    <label>Login-Sitzungsdauer (Tage)</label>
                    <input className="prop-input" type="number" min={1} max={365} value={s.sessionDays} onChange={(e) => set('sessionDays', e.target.value)} />
                  </>
                )}

                {tab === 'zugang' && (
                  <>
                    <label>Wer darf sich registrieren?</label>
                    <select className="prop-select" value={s.signupMode} onChange={(e) => set('signupMode', e.target.value)}>
                      <option value="invite">Nur per Einladung</option>
                      <option value="domain">E-Mail-Domain freigegeben</option>
                      <option value="open">Offen (jeder)</option>
                    </select>
                    {s.signupMode === 'domain' && (
                      <>
                        <label>Erlaubte Domains (Komma-getrennt)</label>
                        <input className="prop-input" placeholder="salt.md, firma.de" value={s.allowedDomains} onChange={(e) => set('allowedDomains', e.target.value)} />
                      </>
                    )}
                    <p className="dialog-hint settings-hint">
                      Einladungen verschickst du über „Mitglieder" im Workspace-Menü. Für Mail-Versand SMTP im Tab „E-Mail" konfigurieren.
                    </p>

                    <label className="check-label" style={{ marginTop: 10 }}>
                      <input
                        type="checkbox"
                        checked={allowUserWs}
                        onChange={(e) => setAllowUserWs(e.target.checked)}
                      />
                      Nutzer dürfen eigene Workspaces anlegen
                    </label>
                    <p className="dialog-hint settings-hint">
                      Aus: nur Admins legen Workspaces an. An (Standard): jeder kann einen eigenen
                      Workspace erstellen und wird dessen Admin — er verwaltet dann nur die
                      Mitglieder SEINES Workspace, nicht die Instanz.
                    </p>

                    <h3>Login mit Google / Microsoft (OAuth)</h3>
                    <p className="dialog-hint settings-hint">
                      Sobald Client-ID und Secret gespeichert sind, zeigt die Login-Seite automatisch den
                      Button. Neue Konten folgen der Registrierungs-Richtlinie oben (bei „nur per Einladung"
                      können sich nur bestehende Konten per OAuth anmelden). Redirect-URIs für die
                      Provider-Konsole:
                    </p>
                    {(() => {
                      const quickUrl = pa && pa.status === 'running' && pa.mode === 'quick' ? pa.url : '';
                      const base = (s.publicBaseUrl || quickUrl || window.location.origin).replace(/\/$/, '');
                      const insecure = base.startsWith('http://') && !/^http:\/\/(localhost|127\.)/.test(base);
                      return (
                        <>
                          <label>Google</label>
                          <input className="prop-input" readOnly value={base + '/api/oauth/google/callback'} onFocus={(e) => e.currentTarget.select()} />
                          <label>Microsoft</label>
                          <input className="prop-input" readOnly value={base + '/api/oauth/microsoft/callback'} onFocus={(e) => e.currentTarget.select()} />
                          {insecure && (
                            <p className="dialog-hint settings-hint pa-warn">
                              ⚠ Google & Microsoft akzeptieren nur <strong>HTTPS</strong>-Redirect-URIs (außer localhost).
                              Starte einen Tunnel (Tab „Domain &amp; Proxy") oder trage unter „Allgemein" eine
                              öffentliche HTTPS-Basis-URL ein — dann erscheint sie hier automatisch.
                            </p>
                          )}
                          {!s.publicBaseUrl && quickUrl && (
                            <p className="dialog-hint settings-hint pa-warn">
                              ⚠ Das ist die URL des laufenden <strong>Quick-Tunnels</strong> — sie wechselt bei jedem
                              Start. Für dauerhaftes OAuth einen benannten Tunnel oder eine eigene Domain nutzen und
                              als Basis-URL eintragen.
                            </p>
                          )}
                        </>
                      );
                    })()}
                    <div className="pa-card">
                      <strong>Google</strong>
                      <p className="dialog-hint settings-hint">
                        console.cloud.google.com → APIs &amp; Services → Credentials → „OAuth client ID"
                        (Web application) → obige Redirect-URI eintragen.
                      </p>
                      <label>Client-ID</label>
                      <input className="prop-input" placeholder="…apps.googleusercontent.com" value={s.googleClientId} onChange={(e) => set('googleClientId', e.target.value)} />
                      <label>Client-Secret</label>
                      <input className="prop-input" type="password" placeholder={oauthSet.google ? '•••••• (gespeichert)' : 'GOCSPX-…'} value={s.googleClientSecret} onChange={(e) => set('googleClientSecret', e.target.value)} />
                    </div>
                    <div className="pa-card">
                      <strong>Microsoft</strong>
                      <p className="dialog-hint settings-hint">
                        portal.azure.com → App registrations → New (unterstützte Kontotypen: „Any org +
                        personal accounts") → Redirect-URI (Web): wie oben, nur mit{' '}
                        <code>/api/oauth/microsoft/callback</code> → Zertifikate &amp; Geheimnisse → Client-Secret.
                      </p>
                      <label>Client-ID (Application-ID)</label>
                      <input className="prop-input" placeholder="00000000-0000-…" value={s.msClientId} onChange={(e) => set('msClientId', e.target.value)} />
                      <label>Client-Secret</label>
                      <input className="prop-input" type="password" placeholder={oauthSet.ms ? '•••••• (gespeichert)' : 'Secret-Wert'} value={s.msClientSecret} onChange={(e) => set('msClientSecret', e.target.value)} />
                    </div>
                  </>
                )}

                {tab === 'email' && (
                  <>
                    <h3>Versand über Google / Microsoft — ohne SMTP</h3>
                    {mail.provider ? (
                      <>
                        <div className="pa-status pa-running">
                          <span className="pa-dot" />
                          Verbunden: sendet als <strong>{s.mailFrom || mail.address || mail.provider}</strong>
                          {' '}({mail.provider === 'google' ? 'Gmail' : 'Microsoft'})
                          <button className="btn-sm" disabled={mailBusy} onClick={() => void mailTest()}>Test-Mail senden</button>
                          <button className="btn-sm" onClick={() => void mailDisconnect()}>Trennen</button>
                        </div>
                        <label>Absender-Adresse überschreiben (optional, Alias)</label>
                        <input
                          className="prop-input"
                          placeholder={mail.address || 'noreply@firma.de'}
                          value={s.mailFrom}
                          onChange={(e) => set('mailFrom', e.target.value)}
                        />
                        <p className="dialog-hint settings-hint">
                          Nur nötig, wenn nicht als <code>{mail.address}</code> gesendet werden soll. Die
                          Adresse muss ein Alias des verbundenen Postfachs sein (Gmail: „Senden als" in den
                          Gmail-Einstellungen verifizieren; Microsoft: Alias/Send-As-Recht). Anderes Postfach
                          komplett? „Trennen" und beim Neu-Verbinden im Kontowahl-Dialog das gewünschte Konto
                          wählen.
                        </p>
                      </>
                    ) : (
                      <div className="pa-card">
                        <p className="dialog-hint settings-hint" style={{ margin: 0 }}>
                          Nutzt die OAuth-Apps aus dem Zugang-Tab: einmal verbinden und Einladungen gehen
                          über das gewählte Postfach — kein SMTP nötig. Erst dort Client-ID/-Secret hinterlegen
                          und speichern, dann hier verbinden. Im Anmeldefenster kannst du <strong>jedes
                          beliebige Konto wählen</strong> — auch ein eigenes Versand-Postfach wie{' '}
                          <code>noreply@firma.de</code>, es muss nicht dein Login-Konto sein.
                        </p>
                        <div className="settings-row">
                          <a
                            className={'btn' + (oauthSet.google ? '' : ' btn-disabled')}
                            href={oauthSet.google ? '/api/admin/mail-oauth/google/start' : undefined}
                            onClick={(e) => { if (!oauthSet.google) { e.preventDefault(); toast('Zuerst Google-OAuth im Zugang-Tab einrichten'); } }}
                          >
                            Mit Google verbinden
                          </a>
                          <a
                            className={'btn' + (oauthSet.ms ? '' : ' btn-disabled')}
                            href={oauthSet.ms ? '/api/admin/mail-oauth/microsoft/start' : undefined}
                            onClick={(e) => { if (!oauthSet.ms) { e.preventDefault(); toast('Zuerst Microsoft-OAuth im Zugang-Tab einrichten'); } }}
                          >
                            Mit Microsoft verbinden
                          </a>
                        </div>
                        <p className="dialog-hint settings-hint" style={{ margin: 0 }}>
                          Google: In der Cloud Console zusätzlich die <strong>Gmail API aktivieren</strong>{' '}
                          (APIs &amp; Services → Library) und die OAuth-App auf „In Produktion" stellen,
                          sonst läuft die Verbindung nach 7 Tagen ab.
                        </p>
                      </div>
                    )}

                    <h3>Oder klassisch: SMTP</h3>
                    <div className="settings-row" style={{ justifyContent: 'flex-start' }}>
                      <button className="btn-sm" disabled={mailBusy} onClick={() => void mailTest()}>Test-Mail senden</button>
                    </div>
                    <label>Host</label>
                    <input className="prop-input" placeholder="smtp.example.com" value={s.smtpHost} onChange={(e) => set('smtpHost', e.target.value)} />
                    <label>Port</label>
                    <input className="prop-input" placeholder="587 / 465" value={s.smtpPort} onChange={(e) => set('smtpPort', e.target.value)} />
                    <label>Benutzer</label>
                    <input className="prop-input" value={s.smtpUser} onChange={(e) => set('smtpUser', e.target.value)} />
                    <label>Passwort</label>
                    <input className="prop-input" type="password" placeholder={passSet ? '•••••• (unverändert)' : 'nicht gesetzt'} value={s.smtpPass} onChange={(e) => set('smtpPass', e.target.value)} />
                    <label>Absender (From)</label>
                    <input className="prop-input" placeholder="salt@firma.de" value={s.smtpFrom} onChange={(e) => set('smtpFrom', e.target.value)} />
                  </>
                )}

                {tab === 'proxy' && (
                  <>
                    <h3>Öffentlicher Zugang — eingebaut, ohne eigenen Proxy</h3>
                    {pa && (pa.status === 'running' || pa.status === 'starting') && (
                      <div className={'pa-status pa-' + pa.status}>
                        <span className="pa-dot" />
                        {pa.status === 'starting' && 'Tunnel startet…'}
                        {pa.status === 'running' && pa.mode === 'quick' && (
                          <>
                            Öffentlich erreichbar:&nbsp;
                            <a href={pa.url} target="_blank" rel="noreferrer">{pa.url}</a>
                            <button className="btn-sm" onClick={() => { void navigator.clipboard?.writeText(pa.url); toast('Link kopiert'); }}>Kopieren</button>
                          </>
                        )}
                        {pa.status === 'running' && pa.mode === 'token' && (
                          <>Tunnel verbunden — erreichbar unter dem im Cloudflare-Dashboard festgelegten Hostname.</>
                        )}
                        <button className="btn-sm" disabled={tunnelBusy} onClick={() => void tunnel('stop')}>Stoppen</button>
                      </div>
                    )}
                    {pa && pa.status === 'error' && (
                      <div className="pa-status pa-error">
                        <span className="pa-dot" />
                        {pa.lastError || 'Tunnel-Fehler'}
                        <button className="btn-sm" disabled={tunnelBusy} onClick={() => void tunnel('stop')}>Zurücksetzen</button>
                      </div>
                    )}

                    <div className="pa-card">
                      <strong>1 · Sofort testen (Quick-Tunnel)</strong>
                      <p className="dialog-hint settings-hint">
                        Ein Klick, kein Account: erzeugt eine temporäre <code>trycloudflare.com</code>-URL,
                        die auf diese Instanz zeigt. Die URL wechselt bei jedem Start — ideal zum Ausprobieren
                        und schnellen Teilen. {!pa?.cloudflaredHere && 'Beim ersten Start lädt Salt.md das offizielle cloudflared automatisch herunter.'}
                      </p>
                      <div className="settings-row">
                        <button
                          className="btn primary"
                          disabled={tunnelBusy || pa?.status === 'running' || pa?.status === 'starting'}
                          onClick={() => void tunnel('start-quick')}
                        >
                          {tunnelBusy ? 'Bitte warten…' : 'Quick-Tunnel starten'}
                        </button>
                      </div>
                    </div>

                    <div className="pa-card">
                      <strong>2 · Dauerhaft mit eigener Domain (Cloudflare Tunnel)</strong>
                      <p className="dialog-hint settings-hint">
                        Kostenloser Cloudflare-Account nötig: Dashboard → <em>Zero Trust → Networks → Tunnels →
                        Create tunnel</em> → Token kopieren und hier einfügen. Hostname (z.&nbsp;B.{' '}
                        <code>{domain}</code> → <code>http://localhost:80</code>) legst du im Dashboard fest.
                        Salt.md hält den Tunnel am Laufen — auch nach Neustarts. Keine Portfreigaben nötig.
                      </p>
                      <div className="settings-row">
                        <input
                          className="prop-input"
                          style={{ flex: 1 }}
                          type="password"
                          placeholder={pa?.tokenSet ? '•••••• (Token gespeichert)' : 'eyJhIjoi… (Tunnel-Token)'}
                          value={tunnelToken}
                          onChange={(e) => setTunnelToken(e.target.value)}
                        />
                        <button
                          className="btn primary"
                          disabled={tunnelBusy || pa?.status === 'running' || pa?.status === 'starting' || (!tunnelToken.trim() && !pa?.tokenSet)}
                          onClick={() => void tunnel('start-token', tunnelToken.trim() || undefined)}
                        >
                          Verbinden
                        </button>
                      </div>
                    </div>

                    <div className="pa-card">
                      <strong>3 · Direkt mit HTTPS (ohne Cloudflare, z.&nbsp;B. VPS)</strong>
                      <p className="dialog-hint settings-hint">
                        Salt.md holt sich selbst ein Let's-Encrypt-Zertifikat und lauscht auf 80/443 —
                        kein Caddy/nginx nötig. Voraussetzung: DNS-A-Record der Domain zeigt auf diesen
                        Server und die Ports 80+443 sind erreichbar. Nach dem Speichern: Neustart.
                      </p>
                      <div className="settings-row">
                        <input
                          className="prop-input"
                          style={{ flex: 1 }}
                          placeholder="notes.firma.de"
                          value={s.httpsDomain}
                          onChange={(e) => set('httpsDomain', e.target.value)}
                        />
                        <label className="settings-check" style={{ whiteSpace: 'nowrap' }}>
                          <input type="checkbox" checked={httpsEnabled} onChange={(e) => setHttpsEnabled(e.target.checked)} />
                          <span>Aktiv</span>
                        </label>
                      </div>
                    </div>

                    <h3>Manuell — eigener Reverse-Proxy</h3>
                    <label className="settings-check">
                      <input type="checkbox" checked={trustProxy} onChange={(e) => setTrustProxy(e.target.checked)} />
                      <span>
                        Hinter Reverse-Proxy betreiben (<code>X-Forwarded-For</code> vertrauen)
                      </span>
                    </label>
                    <p className="dialog-hint settings-hint">
                      Nur aktivieren, wenn Salt.md hinter Caddy, nginx oder einem Cloudflare-Tunnel läuft — dann sieht die Instanz
                      echte Client-IPs (Login-Schutz, Audit-Log). Ohne Proxy ausgeschaltet lassen, sonst könnten Angreifer ihre IP fälschen.
                    </p>
                    <label>Interne Adresse der Instanz (Upstream)</label>
                    <input className="prop-input" value={upstream} onChange={(e) => setUpstream(e.target.value)} />
                    <p className="dialog-hint settings-hint">
                      Die Domain für die Beispiele kommt aus der öffentlichen Basis-URL (Tab „Allgemein"):{' '}
                      <strong>{domain}</strong>
                    </p>
                    <ConfBlock title="Caddy (automatisches HTTPS)" text={caddyConf} />
                    <ConfBlock title="Cloudflare Tunnel (kein offener Port nötig)" text={cloudflaredConf} />
                    <ConfBlock title="nginx" text={nginxConf} />
                    <p className="dialog-hint settings-hint">
                      Cloudflare: DNS-Eintrag „Proxied" (orange Wolke) lassen, WebSockets sind standardmäßig aktiv. Caddy
                      kümmert sich selbst um Zertifikate und WebSockets. Alternativ direktes TLS ohne Proxy via{' '}
                      <code>SALT_TLS_CERT</code>/<code>SALT_TLS_KEY</code>.
                    </p>
                  </>
                )}

                {tab === 'wartung' && (
                  <>
                    <label>Backup</label>
                    <div className="settings-row">
                      <button className="btn primary" onClick={() => api.download('/api/admin/backup')}>
                        Backup herunterladen (.tar.gz)
                      </button>
                    </div>
                    <p className="dialog-hint settings-hint">
                      Enthält die komplette Datenbank (konsistenter Snapshot) und alle Uploads. Wiederherstellen:{' '}
                      <code>./salt restore backup.tar.gz</code>. Für automatische Backups: <code>./salt backup</code> per Cron.
                    </p>
                    <label>Instanz</label>
                    {!info ? (
                      <p className="dialog-hint">Lädt…</p>
                    ) : (
                      <div className="info-grid">
                        <span>Version</span><strong>{info.version} · {info.goVersion} · {info.os}</strong>
                        <span>Laufzeit</span><strong>{fmtUptime(info.uptimeSec)}</strong>
                        <span>Nutzer / Workspaces</span><strong>{info.users} / {info.workspaces}</strong>
                        <span>Seiten (Papierkorb)</span><strong>{info.pages} ({info.trashed})</strong>
                        <span>Datenbank</span><strong>{fmtBytes(info.dbSize)}</strong>
                        <span>Uploads</span><strong>{fmtBytes(info.uploadsSize)}</strong>
                        <span>Datenverzeichnis</span><strong>{info.dataDir}</strong>
                        <span>Deine IP (Server-Sicht)</span><strong>{info.yourIp}{info.trustProxy ? ' · Proxy-Header aktiv' : ''}</strong>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
          <div className="dialog-buttons">
            <button className="btn" onClick={onClose}>Abbrechen</button>
            <button className="btn primary" onClick={() => void save()}>Speichern</button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

// Calendar subscription: a read-only ICS feed of every date property.
export function CalendarSubModal({ onClose }: { onClose: () => void }) {
  useExclusiveModal(onClose);
  const [info, setInfo] = useState<{ url: string; webcal: string } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  useEffect(() => {
    void api.icsInfo().then(setInfo).catch((e) => setLoadErr((e as Error).message || 'Laden fehlgeschlagen'));
  }, []);
  const rotate = async () => {
    setInfo(await api.icsInfo(true));
    toast('Neuer Kalender-Link erzeugt (alter ist ungültig)');
  };
  return (
    <Portal>
      <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="dialog" role="dialog" aria-modal="true" aria-label="Kalender abonnieren">
          <h2>Kalender abonnieren</h2>
          <p className="dialog-hint">
            Abonniere alle Datums-Eigenschaften deiner Datenbanken in Apple Kalender, Google
            Calendar oder Outlook. Der Link ist privat — teile ihn nicht.
          </p>
          {loadErr ? (
            <div className="login-error">{loadErr}</div>
          ) : !info ? (
            <div className="dialog-hint">Lädt…</div>
          ) : (
            <>
              <label className="dialog-hint">Abo-Link (webcal):</label>
              <input className="prop-input invite-input" readOnly value={info.webcal} onFocus={(e) => e.currentTarget.select()} />
              <div className="dialog-buttons" style={{ justifyContent: 'flex-start', gap: 8 }}>
                <a className="btn primary" href={info.webcal}>In Kalender öffnen</a>
                <button className="btn" onClick={() => void navigator.clipboard?.writeText(info.url)}>URL kopieren</button>
                <button className="btn" onClick={() => void rotate()}>Link zurücksetzen</button>
              </div>
            </>
          )}
          <button className="btn dialog-close" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </Portal>
  );
}

// Personal 2FA (TOTP) setup for the current user.
export function TwoFAModal({ onClose }: { onClose: () => void }) {
  useExclusiveModal(onClose);
  const [status, setStatus] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qr?: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.twoFAStatus().then((r) => setStatus(r.enabled));
  }, []);

  const begin = async () => {
    setError(null);
    try {
      setSetup(await api.twoFASetup());
    } catch (e) {
      setError((e as Error).message || '2FA-Setup fehlgeschlagen');
    }
  };
  const enable = async () => {
    setError(null);
    try {
      await api.twoFAEnable(code);
      setStatus(true);
      setSetup(null);
      setCode('');
      toast('2FA aktiviert');
    } catch {
      setError('Falscher Code');
    }
  };
  const disable = async () => {
    setError(null);
    try {
      await api.twoFADisable(code);
      setStatus(false);
      setCode('');
      toast('2FA deaktiviert');
    } catch {
      setError('Falscher Code');
    }
  };

  return (
    <Portal>
      <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="dialog" role="dialog" aria-modal="true" aria-label="Zwei-Faktor-Authentifizierung">
          <h2>Zwei-Faktor-Authentifizierung</h2>
          {status === null && <div className="dialog-hint">Lädt…</div>}

          {status === true && !setup && (
            <>
              <p className="dialog-hint">2FA ist <strong>aktiv</strong>. Zum Deaktivieren einen aktuellen Code eingeben.</p>
              <input className="prop-input" inputMode="numeric" placeholder="6-stelliger Code" value={code} onChange={(e) => setCode(e.target.value)} />
              {error && <div className="login-error">{error}</div>}
              <button className="btn danger" onClick={() => void disable()}>2FA deaktivieren</button>
            </>
          )}

          {status === false && !setup && (
            <>
              <p className="dialog-hint">Schütze dein Konto mit einer Authenticator-App (Google Authenticator, 1Password, …).</p>
              <button className="btn primary" onClick={() => void begin()}>2FA einrichten</button>
            </>
          )}

          {setup && (
            <>
              <p className="dialog-hint">
                Scanne den QR-Code mit deiner Authenticator-App (Google Authenticator, 1Password, …)
                und bestätige mit einem generierten Code. QR und Schlüssel entstehen auf der Instanz
                und verlassen sie nicht.
              </p>
              {setup.qr && <img className="totp-qr" src={setup.qr} alt="QR-Code für die Authenticator-App" />}
              <p className="dialog-hint totp-manual-hint">Kein Scanner? Schlüssel manuell eintippen:</p>
              <code className="totp-secret" onClick={() => void navigator.clipboard?.writeText(setup.secret)}>
                {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
              </code>
              <input className="prop-input" inputMode="numeric" placeholder="6-stelliger Code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
              {error && <div className="login-error">{error}</div>}
              <button className="btn primary" onClick={() => void enable()}>Aktivieren</button>
            </>
          )}

          <button className="btn dialog-close" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </Portal>
  );
}
