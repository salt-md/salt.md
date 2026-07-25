import type {
  ApiToken,
  Backlink,
  CollectionConfig,
  Me,
  Page,
  PageMeta,
  PublicFormConfig,
  SearchResult,
  User,
  Workspace,
} from './types';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* not JSON */
    }
    // A 401 from the auth endpoints is a failed sign-in attempt, and the exact
    // reason matters ("2fa required" makes the login show the code field). Only
    // a 401 ELSEWHERE means the session died — that's what boots to the login
    // screen. Swallowing the body here once locked users out of 2FA accounts.
    if (res.status === 401 && !/^\/api\/(login|signup|setup)\b/.test(url)) {
      window.dispatchEvent(new Event('salt:unauthorized'));
      throw new Error('unauthorized');
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => req<Me>('/api/me'),
  setup: (name: string, email: string, password: string) =>
    req<User>('/api/setup', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  login: (email: string, password: string, code?: string) =>
    req<User>('/api/login', { method: 'POST', body: JSON.stringify({ email, password, code }) }),
  logout: () => req<{ ok: boolean }>('/api/logout', { method: 'POST' }),
  signup: (name: string, email: string, password: string) =>
    req<User>('/api/signup', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  signupPolicy: () => req<{ mode: string; allowedDomains: string; instanceName: string; oauthGoogle: boolean; oauthMicrosoft: boolean }>('/api/signup-policy'),

  getSettings: () =>
    req<{
      instanceName: string;
      signupMode: string;
      allowedDomains: string;
      smtpHost: string;
      smtpPort: string;
      smtpUser: string;
      smtpFrom: string;
      smtpPassSet: boolean;
      publicBaseUrl: string;
      trustProxy: boolean;
      allowUserWorkspaces: boolean;
      maxUploadMb: number;
      trashDays: number;
      sessionDays: number;
      httpsDomain: string;
      httpsEnabled: boolean;
      googleClientId: string;
      googleSecretSet: boolean;
      msClientId: string;
      msSecretSet: boolean;
      mailProvider: string;
      mailAddress: string;
      mailFrom: string;
    }>('/api/settings'),
  mailTest: () => req<{ ok: boolean; to: string }>('/api/admin/mail-test', { method: 'POST', body: '{}' }),
  mailDisconnect: () => req<{ ok: boolean }>('/api/admin/mail-oauth/disconnect', { method: 'POST', body: '{}' }),
  adminInfo: () =>
    req<{
      version: string;
      goVersion: string;
      os: string;
      uptimeSec: number;
      users: number;
      workspaces: number;
      pages: number;
      trashed: number;
      dbSize: number;
      uploadsSize: number;
      dataDir: string;
      yourIp: string;
      trustProxy: boolean;
    }>('/api/admin/info'),
  publicAccess: () =>
    req<{
      status: string;
      mode: string;
      url: string;
      lastError: string;
      tokenSet: boolean;
      autostart: boolean;
      cloudflaredHere: boolean;
      httpsDomain: string;
      httpsEnabled: boolean;
      localUrl: string;
    }>('/api/admin/public-access'),
  tunnelAction: (action: string, token?: string) =>
    req<unknown>('/api/admin/tunnel', { method: 'POST', body: JSON.stringify({ action, token }) }),
  putSettings: (patch: Record<string, unknown>) =>
    req<unknown>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  createInvite: (email: string, role: string, workspaceId: string) =>
    req<{ link: string; emailed: boolean }>('/api/invites', {
      method: 'POST',
      body: JSON.stringify({ email, role, workspaceId }),
    }),
  inviteInfo: (token: string) =>
    req<{ email: string; workspace: string }>(`/api/invites/${token}`),
  acceptInvite: (token: string, name: string, email: string, password: string, code = '') =>
    req<User>(`/api/invites/${token}/accept`, {
      method: 'POST',
      body: JSON.stringify({ name, email, password, code }),
    }),
  icsInfo: (rotate = false) =>
    req<{ url: string; webcal: string }>(`/api/ics${rotate ? '?rotate=1' : ''}`),
  twoFAStatus: () => req<{ enabled: boolean }>('/api/2fa'),
  twoFASetup: () =>
    req<{ secret: string; otpauthUrl: string; qr: string }>('/api/2fa/setup', { method: 'POST' }),
  twoFAEnable: (code: string) =>
    req<{ enabled: boolean }>('/api/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
  twoFADisable: (code: string) =>
    req<{ enabled: boolean }>('/api/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) }),

  listUsers: () => req<User[]>('/api/users'),
  accessOverview: () =>
    req<{ workspaces: { id: string; name: string }[]; memberships: { userId: string; workspaceId: string; role: string }[] }>('/api/admin/access'),
  setMembership: (userId: string, workspaceId: string, role: string) =>
    req<{ ok: boolean }>('/api/admin/membership', { method: 'PUT', body: JSON.stringify({ userId, workspaceId, role }) }),
  // Notfallzugriff: befristete Einsicht in einen fremden Workspace. Anfordern
  // darf nur der Owner; einsehen und beenden auch dessen Verantwortliche.
  breakGlass: (workspaceId: string, reason: string) =>
    req<{ ok: boolean; expiresAt: string; workspace: string }>(`/api/workspaces/${workspaceId}/break-glass`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  listBreakGlass: (workspaceId: string) =>
    req<
      { id: string; user: string; reason: string; createdAt: string; expiresAt: string; revokedAt: string | null; active: boolean }[]
    >(`/api/workspaces/${workspaceId}/break-glass`),
  revokeBreakGlass: (workspaceId: string, grantId: string) =>
    req<{ ok: boolean }>(`/api/workspaces/${workspaceId}/break-glass/${grantId}`, { method: 'DELETE' }),
  createUser: (u: { name: string; email: string; password: string; isAdmin: boolean; workspaces?: { id: string; role: string }[] }) =>
    req<User>('/api/users', { method: 'POST', body: JSON.stringify(u) }),
  updateUser: (id: string, patch: Partial<{ name: string; email: string; color: string; avatar: string; password: string; currentPassword: string; isAdmin: boolean }>) =>
    req<User>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteUser: (id: string) => req<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),

  listTokens: () => req<ApiToken[]>('/api/tokens'),
  createToken: (name: string, scope: 'read' | 'write' = 'write', workspaces: string[] = []) =>
    req<{ id: string; token: string; scope: string; workspaces: string[] }>('/api/tokens', {
      method: 'POST',
      body: JSON.stringify({ name, scope, workspaces }),
    }),
  deleteToken: (id: string) => req<{ ok: boolean }>(`/api/tokens/${id}`, { method: 'DELETE' }),

  listPages: () => req<PageMeta[]>('/api/pages'),
  createPage: (
    parentId: string | null,
    title = '',
    type: 'doc' | 'collection' = 'doc',
    props?: Record<string, unknown>,
    workspaceId?: string,
  ) =>
    req<Page>('/api/pages', {
      method: 'POST',
      body: JSON.stringify({ parentId, title, type, props, workspaceId }),
    }),
  getPage: (id: string) => req<Page>(`/api/pages/${id}`),
  updatePage: (
    id: string,
    patch: Partial<{
      title: string;
      icon: string;
      cover: string;
      content: unknown;
      props: Record<string, unknown>;
      propsPatch: Record<string, unknown>;
      parentId: string | null;
      position: number;
      visibility: 'workspace' | 'private';
      isTemplate: boolean;
      tags: string[];
      description: string;
      // Umzug in einen anderen Workspace: nimmt den ganzen Unterbaum mit und
      // legt die Seite dort auf oberster Ebene ab.
      workspaceId: string;
    }>,
    opts?: { materialize?: boolean },
  ) =>
    req<Page>(`/api/pages/${id}${opts?.materialize ? '?materialize=1' : ''}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  trashPage: (id: string) => req<{ ok: boolean }>(`/api/pages/${id}`, { method: 'DELETE' }),
  duplicatePage: (id: string, fromTemplate = false) =>
    req<{ id: string }>(`/api/pages/${id}/duplicate${fromTemplate ? '?fromTemplate=1' : ''}`, {
      method: 'POST',
    }),
  importMarkdown: (parentId: string | null, title: string, markdown: string) =>
    req<{ id: string }>('/api/import', {
      method: 'POST',
      body: JSON.stringify({ parentId, title, markdown }),
    }),
  importZip: async (file: File): Promise<{ created: number; skipped: number }> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/import-zip', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'import failed');
    return res.json() as Promise<{ created: number; skipped: number }>;
  },
  deleteForever: (id: string) =>
    req<{ ok: boolean }>(`/api/pages/${id}?permanent=1`, { method: 'DELETE' }),
  restorePage: (id: string) =>
    req<{ ok: boolean }>(`/api/pages/${id}/restore`, { method: 'POST' }),
  reindexSiblings: (parentId: string | null, workspaceId?: string) =>
    req<{ reindexed: number }>('/api/reindex-siblings', {
      method: 'POST',
      body: JSON.stringify({ parentId, workspaceId }),
    }),
  search: (q: string) => req<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
  backlinks: (id: string) => req<Backlink[]>(`/api/pages/${id}/backlinks`),
  graph: () => req<{ edges: { source: string; target: string }[] }>('/api/graph'),

  getCollection: (pageId: string) => req<CollectionConfig>(`/api/collections/${pageId}`),
  collectionRows: (
    pageId: string,
    opts: {
      limit?: number;
      offset?: number;
      filters?: { property: string; op?: string; value: string }[];
      sort?: { property: string; dir: 'asc' | 'desc' } | null;
    } = {},
  ) => {
    const p = new URLSearchParams();
    if (opts.limit) p.set('limit', String(opts.limit));
    if (opts.offset) p.set('offset', String(opts.offset));
    for (const f of opts.filters ?? []) p.append('filter', `${f.property}:${f.op ?? ''}:${f.value}`);
    if (opts.sort) p.set('sort', `${opts.sort.property}:${opts.sort.dir}`);
    return req<{
      rows: {
        id: string;
        title: string;
        icon: string;
        cover: string;
        position: number;
        props: Record<string, unknown>;
        tags?: string[];
      }[];
      total: number;
      offset: number;
      limit: number;
    }>(`/api/collections/${pageId}/rows?${p.toString()}`);
  },
  putCollection: (pageId: string, config: CollectionConfig) =>
    req<CollectionConfig>(`/api/collections/${pageId}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  audit: (before?: number) =>
    req<import('./types').AuditEntry[]>(`/api/audit${before ? `?before=${before}` : ''}`),

  listRevisions: (pageId: string) => req<import('./types').Revision[]>(`/api/pages/${pageId}/revisions`),
  getRevision: (pageId: string, revId: string) =>
    req<{ title: string; content: unknown[]; createdAt: string; authorName: string }>(
      `/api/pages/${pageId}/revisions/${revId}`,
    ),
  restoreRevision: (pageId: string, revId: string) =>
    req<{ ok: boolean }>(`/api/pages/${pageId}/revisions/${revId}/restore`, { method: 'POST' }),

  listComments: (pageId: string) => req<import('./types').Comment[]>(`/api/pages/${pageId}/comments`),
  // Offene Kommentare je Seite eines Workspace, in einem Rutsch — fuer die
  // Zaehler auf Kanban-Karten. Bewusst nicht Teil der Seitenliste (siehe
  // handleCommentCounts).
  commentCounts: (workspaceId: string) =>
    req<Record<string, number>>(`/api/comment-counts?workspaceId=${encodeURIComponent(workspaceId)}`),
  createComment: (pageId: string, body: string, blockId = '') =>
    req<{ id: string }>(`/api/pages/${pageId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body, blockId }),
    }),
  resolveComment: (id: string, resolved: boolean) =>
    req<{ ok: boolean }>(`/api/comments/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolved }),
    }),
  deleteComment: (id: string) => req<{ ok: boolean }>(`/api/comments/${id}`, { method: 'DELETE' }),

  listTags: () => req<{ tag: string; count: number }[]>('/api/tags'),
  tagColors: (workspaceId: string) =>
    req<Record<string, string>>(`/api/tag-colors?workspace=${encodeURIComponent(workspaceId)}`),
  setTagColor: (workspaceId: string, tag: string, color: string) =>
    req<{ ok: boolean }>('/api/tag-colors', {
      method: 'PUT',
      body: JSON.stringify({ workspaceId, tag, color }),
    }),

  listWorkspaces: () => req<Workspace[]>('/api/workspaces'),
  createWorkspace: (name: string) =>
    req<Workspace>('/api/workspaces', { method: 'POST', body: JSON.stringify({ name }) }),
  // Irreversible: the caller must echo the workspace name back as `confirm`.
  deleteWorkspace: (id: string, confirm: string) =>
    req<{ ok: boolean }>(`/api/workspaces/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm }),
    }),
  updateWorkspace: (id: string, patch: Partial<{ name: string; icon: string; image: string }>) =>
    req<{ ok: boolean }>(`/api/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  addWorkspaceMember: (workspaceId: string, email: string, role: 'admin' | 'member' | 'viewer') =>
    req<{ ok: boolean }>(`/api/workspaces/${workspaceId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),
  listMembers: (workspaceId: string) =>
    req<{ userId: string; name: string; email: string; role: 'admin' | 'member' | 'viewer' }[]>(
      `/api/workspaces/${workspaceId}/members`,
    ),
  updateMember: (workspaceId: string, userId: string, role: 'admin' | 'member' | 'viewer') =>
    req<{ ok: boolean }>(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  removeMember: (workspaceId: string, userId: string) =>
    req<{ ok: boolean }>(`/api/workspaces/${workspaceId}/members/${userId}`, { method: 'DELETE' }),
  sharePage: (id: string, expiresInDays = 0, password = '') =>
    req<{ token: string; url: string }>(`/api/pages/${id}/share`, {
      method: 'POST',
      body: JSON.stringify({ expiresInDays, password }),
    }),
  unsharePage: (id: string) =>
    req<{ ok: boolean }>(`/api/pages/${id}/share`, { method: 'DELETE' }),

  // Resolved external base URL (public_base_url > HTTPS-Domain > Tunnel > Host).
  publicBase: () => req<{ base: string }>('/api/public-base'),

  // Public form sharing (owner side).
  formShareStatus: (collectionId: string) =>
    req<{ shared: boolean }>(`/api/collections/${collectionId}/form-share`),
  createFormShare: (collectionId: string) =>
    req<{ token: string; url: string }>(`/api/collections/${collectionId}/form-share`, { method: 'POST', body: '{}' }),
  deleteFormShare: (collectionId: string) =>
    req<{ ok: boolean }>(`/api/collections/${collectionId}/form-share`, { method: 'DELETE' }),
  // Public form (anonymous side).
  publicFormConfig: (token: string) =>
    req<PublicFormConfig>(`/api/public/form/${token}`),
  publicFormSubmit: (token: string, title: string, props: Record<string, unknown>) =>
    req<{ ok: boolean }>(`/api/public/form/${token}/submit`, {
      method: 'POST',
      body: JSON.stringify({ title, props }),
    }),

  listFavorites: () => req<string[]>('/api/favorites'),
  addFavorite: (pageId: string) =>
    req<{ ok: boolean }>(`/api/favorites/${pageId}`, { method: 'POST' }),
  removeFavorite: (pageId: string) =>
    req<{ ok: boolean }>(`/api/favorites/${pageId}`, { method: 'DELETE' }),

  // Anchor-based download: immune to popup blockers, unlike window.open.
  download: (url: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  },

  // Max upload size — keep in sync with server/pages.go maxUploadSize (50 MiB).
  uploadMaxBytes: 50 * 1024 * 1024,

  // XHR-based so we can drive a global progress bar and give a precise
  // over-limit / server error message. Progress is broadcast on
  // "salt:upload-progress" (0-1) and "salt:upload-done".
  upload: (file: File, pageId?: string): Promise<string> =>
    new Promise((resolve, reject) => {
      if (file.size > api.uploadMaxBytes) {
        reject(new Error(`Datei zu groß (${(file.size / 1048576).toFixed(1)} MB) — max. 50 MB`));
        return;
      }
      const fd = new FormData();
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/upload${pageId ? `?page=${pageId}` : ''}`);
      const emit = (p: number) => window.dispatchEvent(new CustomEvent('salt:upload-progress', { detail: p }));
      emit(0);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) emit(e.loaded / e.total);
      };
      const finish = () => window.dispatchEvent(new Event('salt:upload-done'));
      xhr.onload = () => {
        finish();
        if (xhr.status === 413) return reject(new Error('Datei zu groß — max. 50 MB'));
        if (xhr.status < 200 || xhr.status >= 300) return reject(new Error('Upload fehlgeschlagen'));
        try {
          resolve((JSON.parse(xhr.responseText) as { url: string }).url);
        } catch {
          reject(new Error('Upload fehlgeschlagen'));
        }
      };
      xhr.onerror = () => {
        finish();
        reject(new Error('Upload fehlgeschlagen'));
      };
      xhr.send(fd);
    }),
};
