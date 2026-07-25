export interface PageMeta {
  id: string;
  parentId: string | null;
  title: string;
  icon: string;
  cover: string;
  position: number;
  updatedAt: string;
  trashed: boolean;
  type: 'doc' | 'collection';
  props: Record<string, unknown>;
  workspaceId: string;
  ownerId: string;
  visibility: 'workspace' | 'private';
  isTemplate: boolean;
  tags: string[];
  description: string;
  snippet: string; // plain-text preview for the notes list (derived server-side)
  thumb: string; // first image URL, '' if none
}

export interface Workspace {
  id: string;
  name: string;
  role: 'admin' | 'member' | 'viewer';
  icon: string;
  image: string;
  /** Der eigene Bereich dieses Kontos — gehört ihm, nicht der Instanz. */
  personal?: boolean;
  /** Jedes neu angelegte Konto wird automatisch Mitglied (nur Owner setzt das). */
  autoJoin?: boolean;
}

export interface AuditEntry {
  id: number;
  createdAt: string;
  actorType: 'human' | 'agent';
  actorName: string;
  action: string;
  pageId: string;
  detail: string;
}

export interface Page extends PageMeta {
  content: unknown[];
  createdAt: string;
}

export interface SearchResult {
  id: string;
  title: string;
  icon: string;
  snippet: string;
}

export interface Backlink {
  id: string;
  title: string;
  icon: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  color: string;
  avatar: string;
  isAdmin: boolean;
  /** Instanzrolle: owner betreibt die Instanz, admin verwaltet Menschen. */
  orgRole?: 'owner' | 'admin' | 'member';
}

export interface Me {
  setupRequired: boolean;
  authenticated: boolean;
  user: User | null;
  version: string;
  // Duerfen Nicht-Admins eigene Workspaces anlegen? (Instanz-Setting, W97)
  allowUserWorkspaces?: boolean;
}

export interface Revision {
  id: string;
  createdAt: string;
  authorName: string;
  title: string;
}

export interface Comment {
  id: string;
  blockId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  authorColor?: string;
  authorAvatar?: string;
  resolvedAt: string | null;
}

export interface ApiToken {
  id: string;
  name: string;
  scope: 'read' | 'write';
  workspaces: string[]; // empty = all the user's workspaces
  createdAt: string;
  lastUsedAt: string | null;
}

export type PropType =
  | 'text'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'person'
  | 'relation'
  | 'rollup'
  | 'formula';

export interface PropOption {
  id: string;
  name: string;
  color: string;
}

export interface PropDef {
  id: string;
  name: string;
  type: PropType;
  options?: PropOption[];
  // relation: which collection this links to
  relationCollection?: string;
  // rollup: aggregate a target property over a relation
  rollupRelation?: string;
  rollupTarget?: string;
  rollupAgg?: 'sum' | 'count' | 'avg' | 'min' | 'max';
  // formula: expression over other props, {propId} references
  formula?: string;
  // number/rollup/formula: render a numeric value as a plain number (default),
  // a progress bar, or a ring. numberMax is the value that = 100% (default 100).
  numberDisplay?: 'plain' | 'bar' | 'ring';
  numberMax?: number;
}

export type FilterOp =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'gt'
  | 'lt'
  | 'is_empty'
  | 'is_not_empty';

export interface Filter {
  property: string;
  op?: FilterOp; // default 'is'; legacy empty value = is_not_empty
  value: string;
}

export interface Sort {
  property: string;
  dir: 'asc' | 'desc';
}

export interface ViewDef {
  id: string;
  name: string;
  type: 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'form' | 'timeline';
  groupBy?: string;
  dateProp?: string; // calendar/timeline view: date property (timeline: start)
  endDateProp?: string; // timeline view: optional end-date property (else 1-day bar)
  hidden?: string[]; // property ids hidden in this view
  filters?: Filter[];
  sort?: Sort | null;
  formTitle?: string; // form view: heading above the form
  formDesc?: string; // form view: description under the heading
  formSubmit?: string; // form view: submit-button label
  subItemProp?: string; // table view: a self-relation prop whose value = child rows (renders a tree)
}

export interface CollectionConfig {
  schema: PropDef[];
  views: ViewDef[];
}

// Public form config served (unauthenticated) at /api/public/form/{token} —
// only the fillable field defs, never rows or the rest of the workspace.
export interface PublicFormConfig {
  title: string;
  icon: string;
  formTitle?: string;
  formDesc?: string;
  formSubmit?: string;
  schema: PropDef[];
}
