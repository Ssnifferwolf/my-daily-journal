// Supabase auth + sync service. UI code never talks to Supabase directly.
import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import type { Rec, Store, SyncResult } from './types';
export type { Rec, Store, SyncResult };

type CloudRow = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  server_version: number;
};

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configured = Boolean(url && key);
const sb: SupabaseClient | null = configured ? createClient(url as string, key as string) : null;
const need = (): SupabaseClient => { if (!sb) throw new Error('Cloud sync is not configured'); return sb; };

// ---- auth ----
export const getSession = async (): Promise<Session | null> => (sb ? (await sb.auth.getSession()).data.session : null);
export const onAuth = (cb: (s: Session | null) => void): void => { sb?.auth.onAuthStateChange((_e, s) => cb(s)); };
export const signIn = (email: string, password: string) => need().auth.signInWithPassword({ email, password });
export const signUp = (email: string, password: string) => need().auth.signUp({ email, password });
export const signOut = () => need().auth.signOut();
export const resetPassword = (email: string) =>
  need().auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });

// ---- sync ----
const CUR = 'mdj:cursor:', LAST = 'mdj:last:';
export const lastSync = (uid: string): string | null => localStorage.getItem(LAST + uid);
const iso = (s: string): string => new Date(s).toISOString();
const rowId = (r: Rec): string => (r.type === 'setting' ? (r.rid ??= crypto.randomUUID()) : r.id);
const strip = (r: Rec): Record<string, unknown> => { const { dirty, base, rid, ...d } = r; void dirty; void base; void rid; return d; };

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    const parts = [e.message, e.details, e.hint].filter((v): v is string => typeof v === 'string' && !!v.trim());
    if (typeof e.code === 'string' && !parts.includes(e.code)) parts.unshift(`[${e.code}]`);
    if (parts.length) return parts.join(' — ');
  }
  return typeof error === 'string' ? error : 'An unknown error occurred';
}

async function retry<T>(fn: () => Promise<T>, n = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= n - 1) throw e; await new Promise((r) => setTimeout(r, 500 * 2 ** i)); }
  }
}

function pullOne(row: CloudRow, st: Store, res: SyncResult): void {
  const isSet = row.type === 'setting', ts = iso(row.updated_at);
  const remote: Rec = { ...row.data, id: isSet ? 'settings' : row.id, type: row.type, created: iso(row.created_at),
    updated: ts, deleted: row.deleted_at ? iso(row.deleted_at) : null, base: ts, dirty: false };
  if (isSet) remote.rid = row.id;
  const loc = st.get(remote.id);
  if (!loc) { st.apply(remote); res.pulled++; return; }
  if (loc.base === ts) return;                                   // our own push or unchanged
  if (!loc.dirty || (loc.type === 'setting' && !loc.base)) { st.apply(remote); res.pulled++; return; }
  res.conflicts++;                                               // both sides changed
  if (loc.type === 'note') {                                     // never lose text: keep both
    const now = new Date().toISOString();
    st.apply({ ...loc, id: crypto.randomUUID(), title: String(loc.title || 'Untitled') + ' (conflict copy)',
      created: now, updated: now, dirty: true, base: undefined, pin: false });
    st.apply(remote); res.pulled++;
  } else if (loc.updated > ts) st.apply({ ...loc, base: ts });   // newer local edit wins and will push
  else { st.apply(remote); res.pulled++; }
}

export async function sync(uid: string, st: Store): Promise<SyncResult> {
  const c = need(), res: SyncResult = { pushed: 0, pulled: 0, conflicts: 0, errors: 0, errorMessages: [] };
  let cur = Number(localStorage.getItem(CUR + uid) || 0);
  for (;;) {                                                     // 1. pull changes since the cursor
    const rows: CloudRow[] = await retry(async () => {
      const q = await c.from('records').select('*').gt('server_version', cur).order('server_version').limit(500);
      if (q.error) throw q.error; return (q.data ?? []) as CloudRow[];
    });
    for (const row of rows) { cur = Math.max(cur, Number(row.server_version)); pullOne(row, st, res); }
    if (rows.length < 500) break;
  }
  for (const r of st.all().filter((x) => x.dirty)) {             // 2. push local changes
    const id = rowId(r), data = strip(r), ts = r.updated;
    try {
      if (r.base) {                                              // optimistic check: only update the version we last saw
        const q = await c.from('records').update({ data, updated_at: ts, deleted_at: r.deleted }).eq('id', id).eq('updated_at', r.base).select('id');
        if (q.error) throw q.error;
        if (!q.data?.length) { res.conflicts++; continue; }      // remote changed meanwhile; next pull resolves it
      } else {
        const q = await c.from('records').insert({ id, type: r.type, data, created_at: r.created, updated_at: ts, deleted_at: r.deleted });
        if (q.error) { if (q.error.code === '23505') { res.conflicts++; continue; } throw q.error; }  // duplicate id
      }
      r.base = ts; r.dirty = r.updated !== ts; st.apply(r); res.pushed++;
    } catch (error) { res.errors++; res.errorMessages.push(errorMessage(error)); }
  }
  localStorage.setItem(CUR + uid, String(cur));
  if (!res.errors) localStorage.setItem(LAST + uid, new Date().toISOString());
  return res;
}
