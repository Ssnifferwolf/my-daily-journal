export interface Rec {
  id: string;
  type: string;
  created: string;
  updated: string;
  deleted: string | null;
  dirty?: boolean;
  base?: string;
  rid?: string;
  demo?: boolean;
  [k: string]: unknown;
}

export interface Note extends Rec {
  type: 'note';
  title: string;
  html: string;
  date: string;
  due: string;
  tags: string[];
  cat: string;
  fav: boolean;
  pin: boolean;
  arch: boolean;
  trash: boolean | string;
  kind: string;
}

export interface Task extends Rec {
  type: 'task';
  title: string;
  desc: string;
  due: string;
  time: string;
  prio: string;
  cat: string;
  done: boolean;
  notes: string;
  top: string | null;
}

export interface Habit extends Rec {
  type: 'habit';
  name: string;
  startTime: string;
  endTime: string;
  time?: string; // Legacy single-time habits remain compatible.
  log: Record<string, string>;
}

export interface Milestone {
  t: string;
  k: string;
  done: boolean;
}

export interface Goal extends Rec {
  type: 'goal';
  title: string;
  desc: string;
  due: string;
  ms: Milestone[];
}

export interface Refl extends Rec {
  type: 'refl';
  kind: string;
  date: string;
  ans: string[];
}

export interface Settings extends Rec {
  type: 'setting';
  theme: 'system' | 'light' | 'dark';
  ws: number;
  jt: string;
  quote: string;
  quotes?: string[];
  qoff?: number;
  tpl: Record<string, string[]>;
  seeded?: boolean;
  owner?: string;
}

export type RecKind = 'note' | 'task' | 'habit' | 'goal' | 'refl' | 'setting';

export interface Store {
  all(): Rec[];
  get(id: string): Rec | undefined;
  apply(r: Rec): void;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: number;
  errorMessages: string[];
}
