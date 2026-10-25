import type { User } from '@supabase/supabase-js';
import * as Cloud from './cloud';
import type { Goal, Habit, Milestone, Note, Rec, Refl, Settings, Store, Task } from './types';

let U: User | null = null;
let SY: { state: 'idle' | 'syncing' | 'error' | 'ok'; msg: string; last: string | null } = { state: 'idle', msg: '', last: null };
let stm: ReturnType<typeof setTimeout> | undefined, busy = false;
const $ = <T extends Element = HTMLElement>(s: string, e: ParentNode = document) => e.querySelector(s) as T | null;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'i' + Date.now() + Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();
const z = (n: number) => String(n).padStart(2, '0');
const dstr = (d: Date) => d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
const today = () => dstr(new Date());
const addD = (s: string, n: number) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return dstr(d); };
const N = [['dash', 'Dashboard', '⌂'], ['jour', 'Daily Journal', '✎'], ['notes', 'All Notes', '☰'], ['cal', 'Calendar', '▦'], ['task', 'Tasks', '✓'], ['hab', 'Habit Tracker', '↻'], ['goal', 'Goals', '◎'], ['morn', 'Morning Reflection', '☀'], ['eve', 'Evening Reflection', '☾'], ['week', 'Weekly Review', '❖'], ['acct', 'Account', '☺'], ['set', 'Settings', '⚙']] as const;
type ViewId = typeof N[number][0];
const VIEWS = new Set<string>(N.map(([k]) => k));
const TPL: Record<string, string[]> = { morn: ['How am I feeling?', 'What matters most today?', 'What are my three priorities?', 'What am I grateful for?'], eve: ['What went well?', 'What did I accomplish?', 'What did I learn?', 'What was difficult?', 'What can I improve?', 'What should I focus on tomorrow?'], week: ['What progress did I make?', 'Which habits were consistent?', 'What obstacles did I face?', 'What should I start, stop, and continue?', 'What are my priorities for next week?'] };
const TITLE: Record<string, string> = { morn: 'Morning Reflection', eve: 'Evening Reflection', week: 'Weekly Review' };
function loadView(): ViewId {
  try { const v = localStorage.getItem('mdj:view'); if (v && VIEWS.has(v)) return v as ViewId; } catch { /* private mode */ }
  return 'dash';
}
let R = new Map<string, Rec>(), db: IDBDatabase | null = null, mem = false, view: ViewId = loadView();
let S: { q: string; tag: string; df: string; sort: 'upd' | 'cre'; scope: 'act' | 'fav' | 'arch' | 'trash'; cur: string | null; jd: string; cm: Date; hv: 'week' | 'month'; rd: string; pend: boolean; am?: 'in' | 'up'; ae?: string; amsg?: string } = { q: '', tag: '', df: '', sort: 'upd', scope: 'act', cur: null, jd: today(), cm: new Date(), hv: 'week', rd: today(), pend: false };
let tm: ReturnType<typeof setTimeout> | undefined;
// ---------- storage layer (IndexedDB; in-memory fallback is flagged, never silent) ----------
const idb = () => new Promise<IDBDatabase>((ok, no) => { try { const r = indexedDB.open('my-daily-journal', 1); r.onupgradeneeded = () => r.result.createObjectStore('rec', { keyPath: 'id' }); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error ?? 'idb'); r.onblocked = () => no('blocked'); } catch (e) { no(e); } });
const idbAll = () => new Promise<Rec[]>((ok, no) => { const q = db!.transaction('rec').objectStore('rec').getAll(); q.onsuccess = () => ok(q.result as Rec[]); q.onerror = () => no(q.error); });
const put = (r: Rec) => { if (!db) return; try { const t = db.transaction('rec', 'readwrite'); t.objectStore('rec').put(r); t.onerror = () => st('Save error'); } catch { st('Save error'); } };
const clearDB = () => { if (db) db.transaction('rec', 'readwrite').objectStore('rec').clear(); };
// ---------- repository (every record: id, type, created, updated, deleted tombstone, dirty = not yet synced) ----------
function L(t: 'note'): Note[];
function L(t: 'task'): Task[];
function L(t: 'habit'): Habit[];
function L(t: 'goal'): Goal[];
function L(t: 'refl'): Refl[];
function L(t: string): Rec[];
function L(t: string): Rec[] { return [...R.values()].filter(r => r.type == t && !r.deleted); }
const prefs = (): Settings => R.get('settings') as Settings;
const save = (r: Rec) => { r.updated = now(); r.dirty = true; R.set(r.id, r); put(r); if (U) schedule(); return r; };
const mk = (type: string, d: Record<string, unknown> = {}) => save({ id: uid(), type, created: now(), deleted: null, ...d } as Rec);
const rm = (r: Rec) => { r.deleted = now(); save(r); };
function st(t?: string) { const e = $('#st'); if (!e) return; const lab = !Cloud.configured ? 'local only' : !U ? 'signed out · local only' : SY.state == 'syncing' ? 'syncing…' : SY.state == 'error' ? 'sync error' : [...R.values()].some(r => r.dirty) ? 'changes pending' : 'synced'; e.textContent = (navigator.onLine ? 'Online' : 'Offline') + ' · ' + lab + (t ? ' · ' + t : ''); }
// ---------- helpers ----------
const txt = (h: string) => { const d = document.createElement('div'); d.innerHTML = h || ''; return d.textContent || ''; };
const fd = (s: string) => new Date(s + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
interface Field { k: string; l: string; t?: string; v?: string | number; o?: string[] }
function dlg(t: string, f: Field[] = [], ok = 'OK'): Promise<Record<string, string> | null> {
  return new Promise(res => {
    const d = document.createElement('dialog');
    const fid = uid();
    d.setAttribute('aria-labelledby', 'd-' + fid);
    d.innerHTML = `<form method="dialog"><h3 id="d-${fid}">${esc(t)}</h3>${f.map(x => {
      const id = 'f-' + x.k + '-' + fid;
      const ctrl = x.t == 'area' ? `<textarea id="${id}" name="${x.k}" rows="6">${esc(x.v)}</textarea>` : x.t == 'sel' ? `<select id="${id}" name="${x.k}">${(x.o || []).map(o => `<option ${o == x.v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : `<input id="${id}" name="${x.k}" type="${x.t || 'text'}" value="${esc(x.v)}">`;
      return `<label for="${id}">${esc(x.l)}${ctrl}</label>`;
    }).join('')}<div class="row"><button value="c">Cancel</button><button value="ok" class="pri">${esc(ok)}</button></div></form>`;
    document.body.append(d);
    d.onclose = () => { const o = d.returnValue == 'ok' ? Object.fromEntries(new FormData(d.firstChild as HTMLFormElement)) as Record<string, string> : null; d.remove(); res(o); };
    d.showModal();
  });
}
const sure = (m: string) => dlg(m, [], 'Confirm').then(Boolean);
async function dl(name: string, data: string, type: string) { const u = URL.createObjectURL(new Blob([data], { type })), l = document.createElement('a'); l.href = u; l.download = name; document.body.append(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
function theme() { const t = prefs().theme, d = t == 'dark' || (t == 'system' && matchMedia('(prefers-color-scheme:dark)').matches); document.documentElement.dataset.theme = d ? 'dark' : 'light'; }
matchMedia('(prefers-color-scheme:dark)').onchange = () => R.has('settings') && theme();
addEventListener('online', () => st());
addEventListener('offline', () => st());
addEventListener('beforeunload', e => { if (S.pend) { e.preventDefault(); e.returnValue = ''; } });
const bar = (p: number) => `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p)}"><i style="width:${Math.round(p)}%"></i></div>`;
// ---------- notes ----------
const nOf = (n: Note) => [n.title, txt(n.html)].join(' ').toLowerCase();
function nlist() {
  let a = L('note').filter(n => S.scope == 'trash' ? n.trash : S.scope == 'arch' ? n.arch && !n.trash : !n.arch && !n.trash && (S.scope != 'fav' || n.fav));
  if (S.q) a = a.filter(n => nOf(n).includes(S.q.toLowerCase())); if (S.tag) a = a.filter(n => n.tags.includes(S.tag) || n.cat == S.tag); if (S.df) a = a.filter(n => n.date == S.df || n.due == S.df);
  a.sort((x, y) => (y.pin ? 1 : 0) - (x.pin ? 1 : 0) || (S.sort == 'cre' ? y.created.localeCompare(x.created) : y.updated.localeCompare(x.updated)));
  return a.map(n => `<div class="item ${n.id == S.cur ? 'on' : ''}" data-a="open" data-i="${n.id}" tabindex="0"><b>${n.pin ? '📌 ' : ''}${n.fav ? '★ ' : ''}${esc(n.title || 'Untitled')}</b> ${n.demo ? '<span class="demo">sample</span>' : ''}<small>${n.due ? `Due ${n.due} · ` : ''}${n.date} · ${esc(txt(n.html).slice(0, 70))}</small></div>`).join('') || '<p class="mu">Nothing here yet.</p>';
}
function ed(n?: Note) {
  if (!n) return '<div class="card mu">Select a note, or create a new one.</div>'; const t = n.trash;
  return `<div class="card"><div class="row"><input id="et" class="g" placeholder="Title" value="${esc(n.title)}" ${t ? 'disabled' : ''} aria-label="Title"><span class="pill" id="sv">Saved</span></div>
<div class="row" style="margin:8px 0"><input type="date" id="edt" value="${n.date}" style="width:auto" aria-label="Note date"><label class="mu">Due date<input type="date" id="edue" value="${esc(n.due || '')}" style="width:auto" aria-label="Due date"></label><input id="etg" class="g" placeholder="tags, comma separated" value="${esc(n.tags.join(', '))}" aria-label="Tags"><input id="ecat" placeholder="category" value="${esc(n.cat)}" style="width:130px" aria-label="Category"></div>
${t ? '<div class="warn">In trash. <button type="button" data-a="restore">Restore</button> <button type="button" data-a="purge" class="dg">Delete forever</button></div>' : `<div class="row" role="toolbar" aria-label="Formatting"><button type="button" data-a="fmt" data-i="bold"><b>B</b></button><button type="button" data-a="fmt" data-i="italic"><i>I</i></button><button type="button" data-a="fmt" data-i="formatBlock">H</button><button type="button" data-a="fmt" data-i="insertUnorderedList">• List</button><button type="button" data-a="fmt" data-i="chk">☐ Check</button><button type="button" data-a="fmt" data-i="createLink">Link</button></div>`}
<div id="eb" ${t ? '' : 'contenteditable="true"'} role="textbox" aria-multiline="true" aria-label="Note body">${n.html}</div>
${t ? '' : `<div class="row"><button type="button" data-a="pin">${n.pin ? 'Unpin' : 'Pin'}</button><button type="button" data-a="fav">${n.fav ? 'Unfavorite' : 'Favorite'}</button><button type="button" data-a="dup">Duplicate</button><button type="button" data-a="arch">${n.arch ? 'Unarchive' : 'Archive'}</button><button type="button" data-a="trash" class="dg">Move to trash</button></div>`}</div>`;
}
function flush() { clearTimeout(tm); if (!S.pend) return; const n = R.get(S.cur || '') as Note | undefined, t = $('#et') as HTMLInputElement | null; S.pend = false; if (!n || !t) return; const eb = $('#eb'), due = ($('#edue') as HTMLInputElement | null); Object.assign(n, { title: t.value, html: eb ? eb.innerHTML : n.html, date: ($('#edt') as HTMLInputElement | null)?.value || n.date, ...(due ? { due: due.value } : {}), tags: ($('#etg') as HTMLInputElement | null)?.value.split(',').map(s => s.trim()).filter(Boolean) || n.tags, cat: ($('#ecat') as HTMLInputElement | null)?.value.trim() || '' }); save(n); const s = $('#sv'); if (s) s.textContent = 'Saved ' + new Date().toLocaleTimeString(); const l = $('#nl'); if (l) l.innerHTML = nlist(); }
function dirty() { S.pend = true; const s = $('#sv'); if (s) s.textContent = 'Saving…'; clearTimeout(tm); tm = setTimeout(flush, 600); }
const newNote = (o: Record<string, unknown> = {}) => mk('note', { title: '', html: '', date: today(), due: '', tags: [], cat: '', fav: false, pin: false, arch: false, trash: false, kind: 'note', ...o }) as Note;
// ---------- calendar ----------
function monthGrid(sel: string) {
  const m = S.cm, y = m.getFullYear(), mo = m.getMonth(), ws = +prefs().ws, off = (new Date(y, mo, 1).getDay() - ws + 7) % 7, dim = new Date(y, mo + 1, 0).getDate(), has = new Set(L('note').filter(n => !n.trash).map(n => n.date)); let c = '';
  for (let i = 0; i < 7; i++) c += `<small>${'SMTWTFS'[(i + ws) % 7]}</small>`; for (let i = 0; i < off; i++) c += '<i></i>';
  for (let d = 1; d <= dim; d++) { const s = dstr(new Date(y, mo, d)); c += `<button type="button" data-a="day" data-i="${s}" class="${s == sel ? 'on' : ''} ${s == today() ? 'td' : ''}" aria-label="${s}${has.has(s) ? ', has entries' : ''}"${s == sel ? ' aria-current="date"' : ''}>${d}${has.has(s) ? '<b></b>' : ''}</button>`; }
  return `<div class="row" style="justify-content:space-between;margin-bottom:6px"><button type="button" data-a="cm" data-i="-1" aria-label="Previous month">‹</button><b>${m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b><button type="button" data-a="cm" data-i="1" aria-label="Next month">›</button></div><div class="cal">${c}</div>`;
}
// ---------- tasks / habits / goals ----------
const trow = (t: Task) => `<div class="row2"><input type="checkbox" data-a="tdone" data-i="${t.id}" ${t.done ? 'checked' : ''} aria-label="Done: ${esc(t.title)}"><div class="g"><b class="${t.done ? 'dn' : ''}">${esc(t.title)}</b> ${t.demo ? '<span class="demo">sample</span>' : ''}<small style="display:block">${t.due || 'no date'}${t.time ? ' at ' + t.time : ''} · ${t.prio}${t.cat ? ' · ' + esc(t.cat) : ''}${t.desc ? ' · ' + esc(t.desc) : ''}</small></div><button type="button" data-a="ttop" data-i="${t.id}" title="Top-3 priority for today" aria-label="Toggle top priority">${t.top == today() ? '★' : '☆'}</button><button type="button" data-a="tedit" data-i="${t.id}">Edit</button><button type="button" data-a="tfwd" data-i="${t.id}" title="Carry forward" aria-label="Carry forward">→</button><button type="button" data-a="tdel" data-i="${t.id}" class="dg" aria-label="Delete task">✕</button></div>`;
const QD = [
  'Small steps every day add up to a different life.',
  'My future is my responsibility.',
  'Consistency beats intensity.',
  'Progress, not perfection.',
  'Do the next right thing.',
  'Start where you are. Use what you have. Do what you can.',
  'A little progress each day adds up to big results.',
  'Focus on what you can control today.',
  'Your habits shape the life you live.',
  'Make room for the work that matters most.',
  'Done is better than waiting for perfect.',
  'Keep going; future you will be grateful.',
  'One focused hour can change the direction of a day.',
  'You do not have to do everything at once.',
  'Choose progress, then choose it again tomorrow.',
];
const qs = () => { const s = prefs(); if (!Array.isArray(s.quotes) || !s.quotes.length) s.quotes = [...new Set([s.quote, ...QD].filter(Boolean))]; return s.quotes; };
const qcur = () => { const a = qs(); return a[((Math.floor(Date.now() / 1800000) + (prefs().qoff || 0)) % a.length + a.length) % a.length]; };
const trowD = (t: Task) => `<div class="row2" style="align-items:flex-start"><input type="checkbox" data-a="tdone" data-i="${t.id}" ${t.done ? 'checked' : ''} aria-label="Done: ${esc(t.title)}" style="margin-top:5px"><div class="g"><div class="${t.done ? 'dn' : ''}" style="font-weight:500;overflow-wrap:anywhere">${esc(t.title)} ${t.demo ? '<span class="demo">sample</span>' : ''}</div><div class="mu" style="font-size:13px">${t.due || 'no date'}${t.time ? ' at ' + t.time : ''} · ${t.prio}${t.cat ? ' · ' + esc(t.cat) : ''}</div></div><button type="button" data-a="ttop" data-i="${t.id}" aria-label="Toggle top priority">${t.top == today() ? '★' : '☆'}</button></div>`;
function streak(h: Habit) { let d = today(), n = 0; if (!h.log[d]) d = addD(d, -1); while (h.log[d] == 'done') { n++; d = addD(d, -1); } return n; }
const hpct = (h: Habit) => { let s = 0; for (let i = 0; i < 30; i++) { const v = h.log[addD(today(), -i)]; s += v == 'done' ? 1 : v == 'part' ? .5 : 0; } return s / 30 * 100; };
const hStart = (h: Habit) => h.startTime || h.time || '';
const hSchedule = (h: Habit) => hStart(h) ? h.endTime ? `${hStart(h)}–${h.endTime}` : `from ${hStart(h)}` : h.endTime ? `until ${h.endTime}` : '';
const gp = (g: Goal) => g.ms.length ? g.ms.filter(m => m.done).length / g.ms.length * 100 : 0;
function rdays() { if (S.hv == 'month') { const m = new Date(), n = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate(); return Array.from({ length: n }, (_, i) => dstr(new Date(m.getFullYear(), m.getMonth(), i + 1))); } const d = new Date(), o = (d.getDay() - prefs().ws + 7) % 7; const s = addD(today(), -o); return Array.from({ length: 7 }, (_, i) => addD(s, i)); }
const gfields = (g: Partial<Goal>): Field[] => [{ k: 'title', l: 'Title', v: g.title || '' }, { k: 'desc', l: 'Description', t: 'area', v: g.desc || '' }, { k: 'due', l: 'Deadline', t: 'date', v: g.due || '' }];
// ---------- views ----------
const V: Record<string, () => string> = {
  dash() {
    const T = today(), tt = L('task'), td = tt.filter(t => t.due == T).sort((a, b) => (a.time || '99').localeCompare(b.time || '99')), dn = td.filter(t => t.done).length, od = tt.filter(t => !t.done && t.due && t.due < T), top = tt.filter(t => t.top == T).slice(0, 3), hb = L('habit'), hd = hb.filter(x => x.log[T] == 'done').length, h = new Date().getHours(), wk = addD(T, -6), nw = L('note').filter(n => !n.trash && n.date >= wk).length, bs = Math.max(0, ...hb.map(streak)), jt = L('note').some(n => n.kind == 'j' && n.date == T && !n.trash), tile = (v: string, l: string, k: string) => `<button type="button" class="tile" data-a="go" data-i="${k}"><b>${v}</b><small>${l}</small></button>`;
    return `<div class="hd"><div><h2>${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}</h2><p class="mu" style="margin:0">${fd(T)}</p></div><div class="row"><button type="button" data-a="jtoday" class="pri">${jt ? 'Open today’s journal' : 'Write today’s entry'}</button><button type="button" data-a="nn">+ New note</button></div></div>
<div class="tiles">${tile(dn + '/' + td.length, 'Tasks done today', 'task')}${tile(hd + '/' + hb.length, 'Habits done today', 'hab')}${tile(bs + 'd', 'Best current streak', 'hab')}${tile(String(nw), 'Notes in last 7 days', 'notes')}</div>
<div class="card"><div class="row"><input id="qc" class="g" placeholder="Quick capture a thought…" aria-label="Quick capture"><button type="button" class="pri" data-a="qc">Capture</button></div></div>
<div class="grid"><div class="card"><h3>Top 3 priorities</h3>${[0, 1, 2].map(i => top[i] ? trowD(top[i]) : `<div class="row2"><button type="button" data-a="dpick">+ Pick priority ${i + 1}</button></div>`).join('')}</div>
<div class="card"><h3>Today’s tasks · ${dn}/${td.length}</h3>${bar(td.length ? dn / td.length * 100 : 0)}${od.length ? `<div class="warn" style="margin:10px 0 0">${od.length} unfinished from earlier days. <button type="button" data-a="dcarry">Carry to today</button></div>` : ''}${td.map(trowD).join('') || '<p class="mu">Nothing due today.</p>'}</div>
<div class="card"><h3>Habits · ${hd}/${hb.length} today</h3>${bar(hb.length ? hd / hb.length * 100 : 0)}${hb.slice().sort((a, b) => (hStart(a) || '99:99').localeCompare(hStart(b) || '99:99')).map(x => `<div class="row2"><button type="button" class="hk ${x.log[T] == 'done' ? 'done' : ''}" data-a="dhab" data-i="${x.id}" aria-label="Toggle ${esc(x.name)}">${x.log[T] == 'done' ? '✓' : ''}</button><span class="g">${esc(x.name)}</span><small>${hSchedule(x) ? `${hSchedule(x)} · ` : ''}${streak(x)}d streak · ${Math.round(hpct(x))}%</small></div>`).join('') || '<p class="mu">No habits yet. Add some in Habit Tracker.</p>'}</div>
<div class="card"><h3>Active goals</h3>${L('goal').map(g => { const nx = g.ms.find(m => !m.done); return `<div style="margin-bottom:12px"><b>${esc(g.title)}</b> <small>${Math.round(gp(g))}%${g.due ? ' · by ' + g.due : ''}</small>${bar(gp(g))}<small>${nx ? 'Next: ' + esc(nx.t) : 'No open milestones'}</small></div>`; }).join('') || '<p class="mu">No goals yet.</p>'}</div>
<div class="card"><h3>Recent entries</h3>${L('note').filter(n => !n.trash && !n.arch).sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 5).map(n => `<div class="item" data-a="open" data-i="${n.id}" tabindex="0"><b>${esc(n.title || 'Untitled')}</b><small>${n.date} · ${esc(txt(n.html).slice(0, 60))}</small></div>`).join('') || '<p class="mu">No entries yet.</p>'}</div>
<div class="card"><h3>Calendar</h3>${monthGrid(S.jd)}</div></div>
<div class="card"><div class="quote" id="qt">“${esc(qcur())}”</div><div class="row" style="justify-content:center"><button type="button" data-a="qnext">Next quote</button><button type="button" data-a="quote">Customize quotes (${qs().length})</button></div><p class="mu" style="text-align:center;margin:8px 0 0;font-size:13px">Changes automatically every 30 minutes.</p><p class="mu" style="text-align:center;margin:4px 0 0;font-size:13px">© 2026 My Daily Journal by Feysal Haji. All rights reserved.</p></div>`;
  },
  jour() { let n = L('note').find(n => n.kind == 'j' && n.date == S.jd && !n.trash); S.cur = n ? n.id : null; return `<h2>Daily Journal</h2><div class="row" style="margin:8px 0"><button type="button" data-a="jd" data-i="-1" aria-label="Previous day">‹</button><input type="date" id="jdi" value="${S.jd}" style="width:auto" aria-label="Journal date"><button type="button" data-a="jd" data-i="1" aria-label="Next day">›</button><b>${fd(S.jd)}</b></div>${n ? ed(n) : `<div class="card"><p class="mu">No entry for this date.</p><button type="button" class="pri" data-a="jnew">Start entry</button></div>`}`; },
  notes() { return `<h2>All Notes</h2><div class="row" style="margin:8px 0"><input id="sq" class="g" placeholder="Search title and content" value="${esc(S.q)}" aria-label="Search notes"><button type="button" class="pri" data-a="nn">+ New</button></div>
<div class="row" style="margin-bottom:10px"><select id="sc" style="width:auto" aria-label="Note list">${[['act', 'Active'], ['fav', 'Favorites'], ['arch', 'Archive'], ['trash', 'Trash']].map(([k, l]) => `<option value="${k}" ${S.scope == k ? 'selected' : ''}>${l}</option>`).join('')}</select><select id="stg" style="width:auto" aria-label="Filter by tag"><option value="">All tags/categories</option>${[...new Set(L('note').flatMap(n => [...n.tags, n.cat]).filter(Boolean))].map(t => `<option ${S.tag == t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><input type="date" id="sdf" value="${S.df}" style="width:auto" aria-label="Filter by date"><select id="ss" style="width:auto" aria-label="Sort notes"><option value="upd">Last modified</option><option value="cre" ${S.sort == 'cre' ? 'selected' : ''}>Created</option></select></div>
<div class="split"><div class="card" id="nl" style="max-height:70vh;overflow:auto">${nlist()}</div><div id="ep">${ed(R.get(S.cur || '') as Note | undefined)}</div></div>`; },
  cal() { const a = L('note').filter(n => n.date == S.jd && !n.trash); return `<h2>Calendar</h2><div class="grid"><div class="card">${monthGrid(S.jd)}</div><div class="card"><h3>${fd(S.jd)}</h3>${a.map(n => `<div class="item" data-a="open" data-i="${n.id}" tabindex="0"><b>${esc(n.title || 'Untitled')}</b></div>`).join('') || '<p class="mu">No notes on this date.</p>'}<button type="button" class="pri" data-a="nnd">+ Note on this date</button> <button type="button" data-a="jopen">Open journal</button></div></div>`; },
  task() { const t = L('task'), T = today(), f = (x: Task[]) => x.sort((a, b) => (a.due || '9').localeCompare(b.due || '9') || (a.time || '99').localeCompare(b.time || '99')); return `<h2>Tasks</h2><div class="card"><div class="row"><input id="tt" class="g" placeholder="New task…" aria-label="New task"><input type="date" id="td" value="${T}" style="width:auto" aria-label="Due date"><input type="time" id="tm" style="width:auto" aria-label="Time (optional)"><select id="tp" style="width:auto" aria-label="Priority"><option>high</option><option selected>med</option><option>low</option></select><button type="button" class="pri" data-a="tadd">Add</button></div></div>
<div class="card"><h3>Today & overdue</h3>${f(t.filter(x => !x.done && x.due && x.due <= T)).map(trow).join('') || '<p class="mu">Nothing due.</p>'}</div><div class="card"><h3>Upcoming</h3>${f(t.filter(x => !x.done && (!x.due || x.due > T))).map(trow).join('') || '<p class="mu">Nothing upcoming.</p>'}</div><div class="card"><h3>Completed</h3>${t.filter(x => x.done).map(trow).join('') || '<p class="mu">No completed tasks yet.</p>'}</div>`; },
  hab() { const D = rdays(); return `<h2>Habit Tracker</h2><div class="row" style="margin:8px 0"><button type="button" class="pri" data-a="hadd">+ Habit</button><button type="button" data-a="hv">${S.hv == 'week' ? 'Month view' : 'Week view'}</button><small>Click a cell: done → partial → missed → clear</small></div><div class="card hg"><table><thead><tr><th></th>${D.map(d => `<th>${+d.slice(8)}</th>`).join('')}<th>Streak</th><th>30d</th><th></th></tr></thead><tbody>${L('habit').slice().sort((a, b) => (hStart(a) || '99:99').localeCompare(hStart(b) || '99:99')).map(h => `<tr><td>${esc(h.name)}${hSchedule(h) ? ` <small>${hSchedule(h)}</small>` : ''} ${h.demo ? '<span class="demo">sample</span>' : ''}</td>${D.map(d => { const v = h.log[d] || ''; return `<td><button type="button" data-a="hlog" data-i="${h.id}" data-d="${d}" class="${v}" aria-label="${esc(h.name)} ${d} ${v || 'none'}">${{ done: '✓', part: '◐', miss: '✕' }[v] || ''}</button></td>`; }).join('')}<td>${streak(h)}</td><td>${Math.round(hpct(h))}%</td><td><button type="button" data-a="hedit" data-i="${h.id}">Edit</button><button type="button" data-a="hdel" data-i="${h.id}" class="dg" aria-label="Delete habit">✕</button></td></tr>`).join('') || '<tr><td colspan="99" class="mu">No habits yet.</td></tr>'}</tbody></table></div>`; },
  goal() { return `<h2>Goals</h2><button type="button" class="pri" data-a="gadd" style="margin:8px 0">+ Goal</button>${L('goal').map(g => `<div class="card"><div class="row"><h3 class="g">${esc(g.title)} ${g.demo ? '<span class="demo">sample</span>' : ''}</h3><small>${g.due ? 'by ' + g.due : ''} · ${Math.round(gp(g))}%</small><button type="button" data-a="gedit" data-i="${g.id}">Edit</button><button type="button" data-a="gdel" data-i="${g.id}" class="dg">✕</button></div><p class="mu">${esc(g.desc)}</p>${bar(gp(g))}${g.ms.map((m, j) => `<div class="row2"><input type="checkbox" data-a="gms" data-i="${g.id}" data-j="${j}" ${m.done ? 'checked' : ''} aria-label="${esc(m.t)}"><span class="g ${m.done ? 'dn' : ''}">${esc(m.t)} <span class="tag">${esc(m.k)}</span></span><button type="button" data-a="gmdel" data-i="${g.id}" data-j="${j}" class="dg" aria-label="Remove">✕</button></div>`).join('')}<button type="button" data-a="gmadd" data-i="${g.id}">+ Milestone / action step</button></div>`).join('') || '<p class="mu">No goals yet.</p>'}`; },
  set() {
    const s = prefs(), dirtyN = [...R.values()].filter(r => r.dirty && r.id != 'settings').length, demoN = [...R.values()].filter(r => r.demo && !r.deleted).length;
    return `<h2>Settings</h2>
<div class="card"><h3>Preferences</h3><div class="row"><label>Theme <select id="sth" aria-label="Theme">${['system', 'light', 'dark'].map(t => `<option ${s.theme == t ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>Week starts <select id="sws"><option value="1" ${s.ws == 1 ? 'selected' : ''}>Monday</option><option value="0" ${s.ws == 0 ? 'selected' : ''}>Sunday</option></select></label><label>Default journal template <select id="sjt"><option value="">Blank</option>${Object.keys(TITLE).map(k => `<option value="${k}" ${s.jt == k ? 'selected' : ''}>${TITLE[k]}</option>`).join('')}</select></label></div></div>
<div class="card"><h3>Storage & sync status</h3><p><b>Local:</b> ${mem ? '<span class="dg">IndexedDB unavailable — data lives in memory only and will be lost on reload. Export regularly.</span>' : 'IndexedDB in this browser. Not encrypted, and the browser may clear it; not guaranteed across devices or sessions.'}</p>${cloudP(dirtyN)}<p class="mu">AI features: disabled until a secure server-side endpoint exists. No journal text is ever sent anywhere.</p>
<p class="mu">Cloud schema and security policies: see <code>supabase/schema.sql</code> in the project.</p></div>
<div class="card"><h3>Backup</h3><div class="row"><button type="button" data-a="xj">Export JSON</button><button type="button" data-a="xm">Export Markdown</button><button type="button" data-a="xt">Export TXT</button><label class="pill" style="cursor:pointer">Import backup<input type="file" id="imp" accept=".json" hidden></label></div></div>
<div class="card"><h3>Data</h3><div class="row"><button type="button" data-a="demo" ${demoN ? '' : 'disabled'}>Delete sample content (${demoN})</button><button type="button" data-a="wipe" class="dg">Clear all local data</button></div></div>`;
  },
};
const cloudP = (n: number) => !Cloud.configured ? '<p><b>Cloud:</b> not configured in this build. No data leaves this device. See README to enable accounts.</p>' : U ? `<p><b>Cloud:</b> signed in as ${esc(U.email)}. <b>${n}</b> change(s) waiting to sync. Last successful sync: ${SY.last ? new Date(SY.last).toLocaleString() : 'never'}. ${esc(SY.msg || '')}</p>` : '<p><b>Cloud:</b> signed out. Data stays on this device until you sign in. <button type="button" data-a="go" data-i="acct">Sign in</button></p>';
V.acct = () => {
  const off = !Cloud.configured, m = S.am || 'in', h = '<h2>Account</h2>';
  if (U) return h + `<div class="card"><h3>Signed in</h3><p>${esc(U.email)}</p><p>Status: <b>${esc(SY.state)}</b> ${esc(SY.msg || '')}</p><p class="mu">Last successful sync: ${SY.last ? new Date(SY.last).toLocaleString() : 'never'}</p><div class="row"><button type="button" class="pri" data-a="async">Sync now</button><button type="button" data-a="aout">Sign out</button></div><p class="mu">Signing out keeps your data on this device. Your data is stored in your Supabase project with Row Level Security; the copy in this browser is not encrypted. Account deletion needs a server-side function and is not built yet.</p></div>`;
  return h + (off ? '<div class="warn">Login is switched off because this copy was built without a Supabase project. Locally: put VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env and restart npm run dev. On Netlify: add those same two names under Site configuration → Environment variables, then trigger a new deploy (.env is not uploaded from GitHub). Also run supabase/schema.sql and add this site URL in Supabase Authentication URL Configuration. Until then the journal works on this device only.</div>' : '') + `<div class="card" style="max-width:440px"><h3>${m == 'up' ? 'Create account' : 'Sign in'}</h3><label style="display:block;margin:8px 0">Email<input id="ae" type="email" autocomplete="email" value="${esc(S.ae || '')}" ${off ? 'disabled' : ''}></label><label style="display:block;margin:8px 0">Password (8+ characters)<input id="ap" type="password" autocomplete="${m == 'up' ? 'new-password' : 'current-password'}" ${off ? 'disabled' : ''}></label><div class="row"><button type="button" class="pri" data-a="aauth" ${off ? 'disabled' : ''}>${m == 'up' ? 'Create account' : 'Sign in'}</button><button type="button" data-a="amode" ${off ? 'disabled' : ''}>${m == 'up' ? 'I have an account' : 'Create an account'}</button>${m == 'in' ? `<button type="button" data-a="areset" ${off ? 'disabled' : ''}>Forgot password</button>` : ''}</div><p class="mu" role="status">${esc(S.amsg || '')}</p><p class="mu">You can keep using the journal without an account; data then stays on this device.</p></div>`;
};
['morn', 'eve', 'week'].forEach(k => V[k] = () => { const q = prefs().tpl[k], r = L('refl').find(r => r.kind == k && r.date == S.rd); return `<h2>${TITLE[k]}</h2><div class="row" style="margin:8px 0"><input type="date" id="rdi" value="${S.rd}" style="width:auto" aria-label="Reflection date"><button type="button" data-a="tpl" data-i="${k}">Edit template</button></div>${q.map((x, i) => `<div class="card"><label for="q${i}"><b>${esc(x)}</b></label><textarea id="q${i}" rows="3" data-q="${k}" data-n="${i}">${esc(r?.ans?.[i] || '')}</textarea></div>`).join('')}`; });
// ---------- actions ----------
type Act = (el: HTMLElement) => void | Promise<void>;
const A: Record<string, Act> = {
  aauth: async () => { const e = ($('#ae') as HTMLInputElement).value.trim(), p = ($('#ap') as HTMLInputElement).value; S.ae = e; if (!e || p.length < 8) { S.amsg = 'Enter your email and a password of at least 8 characters.'; return render(); } S.amsg = 'Please wait…'; render(); try { const up = S.am == 'up', { data, error } = await (up ? Cloud.signUp : Cloud.signIn)(e, p); if (error) throw error; S.amsg = up && !data.session ? 'Check your email to confirm your account, then sign in.' : ''; } catch (x) { S.amsg = x instanceof Error ? x.message : 'Failed.'; } render(); },
  amode: () => { S.ae = ($('#ae') as HTMLInputElement).value; S.am = S.am == 'up' ? 'in' : 'up'; S.amsg = ''; render(); },
  areset: async () => { const e = ($('#ae') as HTMLInputElement).value.trim(); S.ae = e; if (!e) { S.amsg = 'Enter your email first.'; return render(); } try { const { error } = await Cloud.resetPassword(e); if (error) throw error; S.amsg = 'If that email has an account, a reset link was sent.'; } catch (x) { S.amsg = x instanceof Error ? x.message : 'Failed.'; } render(); },
  aout: async () => { if (await sure('Sign out? Your data stays on this device.')) { await Cloud.signOut(); U = null; SY = { state: 'idle', msg: '', last: null }; render(); } },
  async: () => { void doSync(true); },
  go: e => go(e.dataset.i as ViewId),
  jtoday: () => { S.jd = today(); go('jour'); },
  dhab: e => { const h = R.get(e.dataset.i!) as Habit, T = today(); h.log[T] == 'done' ? delete h.log[T] : h.log[T] = 'done'; save(h); render(); },
  dcarry: () => { L('task').filter(t => !t.done && t.due && t.due < today()).forEach(t => { t.due = today(); save(t); }); render(); },
  dpick: async () => { const c = L('task').filter(t => !t.done && t.top != today()); if (!c.length) return void dlg('No open tasks to pick. Add one in Tasks first.', [], 'OK'); const o = await dlg('Pick a priority', [{ k: 't', l: 'Task', t: 'sel', o: c.map((t, i) => (i + 1) + '. ' + t.title), v: '' }], 'Set'); if (o) { const t = c[parseInt(o.t, 10) - 1]; t.top = today(); save(t); render(); } },
  day: e => { S.jd = e.dataset.i!; S.cm = new Date(S.jd + 'T12:00'); view == 'cal' ? render() : go('jour'); },
  cm: e => { S.cm = new Date(S.cm.getFullYear(), S.cm.getMonth() + +e.dataset.i!, 1); render(); },
  open: e => { flush(); S.cur = e.dataset.i!; go('notes'); },
  nn: () => { flush(); S.cur = newNote().id; S.scope = 'act'; go('notes'); },
  nnd: () => { S.cur = newNote({ date: S.jd }).id; go('notes'); },
  jopen: () => go('jour'),
  qc: () => { const v = ($('#qc') as HTMLInputElement).value.trim(); if (!v) return; newNote({ title: 'Quick capture', html: esc(v) }); render(); },
  quote: async () => { const o = await dlg('Your quotes (one per line)', [{ k: 'q', l: 'Add, edit or delete lines. The Dashboard rotates through them every 30 minutes.', t: 'area', v: qs().join('\n') }], 'Save'); if (o) { const a = o.q.split('\n').map(s => s.trim()).filter(Boolean); if (a.length) { prefs().quotes = a; prefs().qoff = 0; save(prefs()); render(); } } },
  qnext: () => { prefs().qoff = (prefs().qoff || 0) + 1; save(prefs()); render(); },
  jnew: () => { const t = prefs().jt; newNote({ kind: 'j', date: S.jd, title: t ? TITLE[t] : '', html: t ? prefs().tpl[t].map(q => `<h2>${esc(q)}</h2><div><br></div>`).join('') : '' }); render(); },
  jd: e => { flush(); S.jd = addD(S.jd, +e.dataset.i!); render(); },
  fmt: e => { const c = e.dataset.i!; $('#eb')?.focus(); if (c == 'chk') document.execCommand('insertHTML', false, '<div><input type="checkbox"> </div>'); else if (c == 'formatBlock') document.execCommand(c, false, 'h2'); else if (c == 'createLink') { void dlg('Link URL', [{ k: 'u', l: 'URL', v: 'https://' }], 'Add').then(o => { if (o && /^https?:/i.test(o.u)) { $('#eb')?.focus(); document.execCommand('createLink', false, o.u); dirty(); } }); } else document.execCommand(c); dirty(); },
  pin: () => { const n = R.get(S.cur!) as Note; flush(); n.pin = !n.pin; save(n); render(); },
  fav: () => { const n = R.get(S.cur!) as Note; flush(); n.fav = !n.fav; save(n); render(); },
  arch: () => { const n = R.get(S.cur!) as Note; flush(); n.arch = !n.arch; save(n); S.cur = null; render(); },
  dup: () => { const n = R.get(S.cur!) as Note; flush(); S.cur = newNote({ ...n, id: undefined, title: n.title + ' (copy)', pin: false, kind: 'note' }).id; render(); },
  trash: async () => { if (await sure('Move this note to trash? You can restore it later.')) { const n = R.get(S.cur!) as Note; flush(); n.trash = now(); save(n); S.cur = null; render(); } },
  restore: () => { const n = R.get(S.cur!) as Note; n.trash = false; save(n); S.cur = null; render(); },
  purge: async () => { if (await sure('Permanently delete this note? This cannot be undone.')) { rm(R.get(S.cur!)!); S.cur = null; render(); } },
  tadd: () => { const t = ($('#tt') as HTMLInputElement).value.trim(); if (t) { mk('task', { title: t, desc: '', due: ($('#td') as HTMLInputElement).value, time: ($('#tm') as HTMLInputElement).value, prio: ($('#tp') as HTMLSelectElement).value, cat: '', done: false, notes: '', top: null }); render(); } },
  tdone: e => { const t = R.get(e.dataset.i!) as Task; t.done = (e as HTMLInputElement).checked; save(t); render(); },
  ttop: e => { const t = R.get(e.dataset.i!) as Task; if (t.top == today()) t.top = null; else if (L('task').filter(x => x.top == today()).length >= 3) return void dlg('Limit reached', [], 'OK'); else t.top = today(); save(t); render(); },
  tedit: async e => { const t = R.get(e.dataset.i!) as Task, o = await dlg('Edit task', [{ k: 'title', l: 'Title', v: t.title }, { k: 'desc', l: 'Description', v: t.desc }, { k: 'due', l: 'Due', t: 'date', v: t.due }, { k: 'time', l: 'Time', t: 'time', v: t.time }, { k: 'prio', l: 'Priority', t: 'sel', o: ['high', 'med', 'low'], v: t.prio }, { k: 'cat', l: 'Category', v: t.cat }, { k: 'notes', l: 'Notes', t: 'area', v: t.notes }], 'Save'); if (o) { Object.assign(t, o); save(t); render(); } },
  tfwd: async e => { const t = R.get(e.dataset.i!) as Task, o = await dlg('Carry forward to', [{ k: 'due', l: 'New date', t: 'date', v: addD(today(), 1) }], 'Move'); if (o && o.due) { t.due = o.due; save(t); render(); } },
  tdel: async e => { if (await sure('Delete this task?')) { rm(R.get(e.dataset.i!)!); render(); } },
  hadd: async () => { const o = await dlg('New habit', [{ k: 'name', l: 'Name (e.g. Reading, Water, Exercise)' }, { k: 'startTime', l: 'From (optional)', t: 'time' }, { k: 'endTime', l: 'To (optional)', t: 'time' }], 'Add'); if (o && o.name.trim()) { mk('habit', { name: o.name.trim(), startTime: o.startTime || '', endTime: o.endTime || '', log: {} }); render(); } },
  hedit: async e => { const h = R.get(e.dataset.i!) as Habit, o = await dlg('Edit habit', [{ k: 'name', l: 'Name', v: h.name }, { k: 'startTime', l: 'From (optional)', t: 'time', v: hStart(h) }, { k: 'endTime', l: 'To (optional)', t: 'time', v: h.endTime || '' }], 'Save'); if (o && o.name.trim()) { h.name = o.name.trim(); h.startTime = o.startTime || ''; h.endTime = o.endTime || ''; delete h.time; save(h); render(); } },
  hdel: async e => { if (await sure('Delete this habit and its history?')) { rm(R.get(e.dataset.i!)!); render(); } },
  hv: () => { S.hv = S.hv == 'week' ? 'month' : 'week'; render(); },
  hlog: e => { const h = R.get(e.dataset.i!) as Habit, d = e.dataset.d!, c = ['', 'done', 'part', 'miss'], n = c[(c.indexOf(h.log[d] || '') + 1) % 4]; n ? h.log[d] = n : delete h.log[d]; save(h); render(); },
  gadd: async () => { const o = await dlg('New goal', gfields({}), 'Add'); if (o && o.title.trim()) { mk('goal', { ...o, ms: [] }); render(); } },
  gedit: async e => { const g = R.get(e.dataset.i!) as Goal, o = await dlg('Edit goal', gfields(g), 'Save'); if (o) { Object.assign(g, o); save(g); render(); } },
  gdel: async e => { if (await sure('Delete this goal?')) { rm(R.get(e.dataset.i!)!); render(); } },
  gms: e => { const g = R.get(e.dataset.i!) as Goal; g.ms[+e.dataset.j!].done = (e as HTMLInputElement).checked; save(g); render(); },
  gmdel: e => { const g = R.get(e.dataset.i!) as Goal; g.ms.splice(+e.dataset.j!, 1); save(g); render(); },
  gmadd: async e => { const g = R.get(e.dataset.i!) as Goal, o = await dlg('Add item', [{ k: 't', l: 'Text' }, { k: 'k', l: 'Type', t: 'sel', o: ['milestone', 'action step'] }], 'Add'); if (o && o.t.trim()) { g.ms.push({ t: o.t.trim(), k: o.k, done: false } as Milestone); save(g); render(); } },
  tpl: async e => { const k = e.dataset.i!, o = await dlg('Edit template (one question per line)', [{ k: 'q', l: 'Questions', t: 'area', v: prefs().tpl[k].join('\n') }], 'Save'); if (o) { prefs().tpl[k] = o.q.split('\n').map(s => s.trim()).filter(Boolean); save(prefs()); render(); } },
  xj: () => { void dl('my-daily-journal-backup.json', JSON.stringify({ app: 'my-daily-journal', version: 1, exported: now(), records: [...R.values()] }, null, 1), 'application/json'); },
  xm: () => { void dl('my-daily-journal.md', L('note').map(md).join('\n\n---\n\n'), 'text/markdown'); },
  xt: () => { void dl('my-daily-journal.txt', L('note').map(n => `${n.title || 'Untitled'} (${n.date})\n${txt(n.html)}`).join('\n\n====\n\n'), 'text/plain'); },
  demo: async () => { if (await sure('Delete all sample content? Your own data is kept.')) { [...R.values()].filter(r => r.demo && !r.deleted).forEach(rm); render(); } },
  wipe: async () => { if (await sure('Erase ALL local data on this device? Export a backup first. This cannot be undone.') && await sure('Really erase everything?')) { clearDB(); R.clear(); await init(true); go('dash'); } },
};
const md = (n: Note) => { const h = (n.html || '').replace(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi, '\n## $1\n').replace(/<(b|strong)>(.*?)<\/\1>/gi, '**$2**').replace(/<(i|em)>(.*?)<\/\1>/gi, '*$2*').replace(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)').replace(/<li>(.*?)<\/li>/gi, '- $1\n').replace(/<input[^>]*checked[^>]*>/gi, '[x] ').replace(/<input[^>]*>/gi, '[ ] ').replace(/<(br|\/div|\/p)>/gi, '\n').replace(/<[^>]+>/g, ''); const t = document.createElement('textarea'); t.innerHTML = h; return `# ${n.title || 'Untitled'}\n_${n.date}_ ${n.tags.map(x => '#' + x).join(' ')}\n\n${t.value}`; };
async function imp(f: File) {
  try {
    const j = JSON.parse(await f.text()) as { app?: string; records?: Rec[] };
    if (j.app != 'my-daily-journal' || !Array.isArray(j.records)) throw 'Not a My Daily Journal backup.';
    const ok = ['note', 'task', 'habit', 'goal', 'refl', 'setting']; let a = 0, s = 0;
    for (const r of j.records) { if (!r || typeof r.id != 'string' || !ok.includes(r.type) || typeof r.updated != 'string' || typeof r.created != 'string') throw 'Invalid record: ' + JSON.stringify(r).slice(0, 60); }
    for (const r of j.records) { const c = R.get(r.id); if (c && c.updated >= r.updated) { s++; continue; } r.dirty = true; R.set(r.id, r); put(r); a++; }
    theme(); void dlg(`${a} imported, ${s} skipped (local copy was newer).`, [], 'OK'); render();
  } catch (e) { void dlg('Import failed: ' + e, [], 'OK'); }
}
document.addEventListener('click', e => { const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null; if (t && A[t.dataset.a!] && (t as HTMLInputElement).type != 'checkbox') void A[t.dataset.a!](t); });
document.addEventListener('change', e => {
  const t = e.target as HTMLInputElement;
  const a = t.dataset.a;
  if (a && t.type == 'checkbox' && A[a]) return void A[a](t);
  if (t.closest('#eb') && t.type == 'checkbox') { t.toggleAttribute('checked', t.checked); dirty(); }
  const m: Record<string, () => void> = {
    sth: () => { prefs().theme = t.value as Settings['theme']; save(prefs()); theme(); },
    sws: () => { prefs().ws = +t.value; save(prefs()); },
    sjt: () => { prefs().jt = t.value; save(prefs()); },
    sc: () => { S.scope = t.value as typeof S.scope; render(); },
    stg: () => { S.tag = t.value; render(); },
    sdf: () => { S.df = t.value; render(); },
    ss: () => { S.sort = t.value as typeof S.sort; render(); },
    jdi: () => { flush(); S.jd = t.value || today(); render(); },
    rdi: () => { S.rd = t.value || today(); render(); },
  };
  m[t.id]?.();
  if (t.id == 'imp' && t.files?.[0]) void imp(t.files[0]);
});
document.addEventListener('input', e => {
  const t = e.target as HTMLInputElement;
  if (t.id == 'sq') { S.q = t.value; const nl = $('#nl'); if (nl) nl.innerHTML = nlist(); return; }
  if (t.closest('#eb') || ['et', 'edt', 'edue', 'etg', 'ecat'].includes(t.id)) dirty();
  if (t.dataset.q) {
    const k = t.dataset.q;
    let r = L('refl').find(r => r.kind == k && r.date == S.rd);
    if (!r) r = mk('refl', { kind: k, date: S.rd, ans: [] }) as Refl;
    r.ans[+t.dataset.n!] = t.value; clearTimeout(tm); tm = setTimeout(() => { save(r!); st('Saved'); }, 500); st('Saving…');
  }
});
const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName == 'INPUT' || el.tagName == 'TEXTAREA' || el.tagName == 'SELECT' || el.isContentEditable);
document.addEventListener('keydown', e => {
  const t = e.target as HTMLElement;
  if (e.key == 'Enter' && t.id == 'ap') void A.aauth(t);
  if (e.key == 'Enter' && t.id == 'qc') A.qc(t);
  if (e.key == 'Enter' && t.id == 'tt') A.tadd(t);
  if ((e.key == 'Enter' || e.key == ' ') && t.classList?.contains('item') && t.tagName == 'DIV') { e.preventDefault(); t.click(); }
  if (e.key == '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(t)) { e.preventDefault(); go('notes'); requestAnimationFrame(() => ($('#sq') as HTMLInputElement | null)?.focus()); }
});
function go(v: string) { flush(); if (VIEWS.has(v)) { view = v as ViewId; try { localStorage.setItem('mdj:view', view); } catch { /* private mode */ } } render(); scrollTo(0, 0); }
function render() { $('#nav')!.innerHTML = N.map(([k, l, i]) => `<button type="button" data-a="go" data-i="${k}" class="${k == view ? 'on' : ''}" ${k == view ? 'aria-current="page"' : ''}><span aria-hidden="true">${i}</span>${l}</button>`).join(''); $('#main')!.innerHTML = (mem ? '<div class="warn">Browser storage is unavailable here: changes will NOT persist after reload. Use Settings → Export.</div>' : '') + (!mem && [...R.values()].some(r => r.demo && !r.deleted) ? '<div class="warn">Showing sample data. <button type="button" data-a="demo">Delete sample content</button></div>' : '') + V[view](); st(); }
async function init(reseed?: boolean) {
  if (!reseed) { try { db = await idb(); (await idbAll()).forEach(r => R.set(r.id, r)); try { void navigator.storage?.persist?.(); } catch { /* ignore */ } } catch { mem = true; db = null; } }
  if (!R.has('settings')) {
    R.set('settings', { id: 'settings', type: 'setting', created: now(), updated: now(), deleted: null, dirty: true, theme: 'system', ws: 1, jt: '', quote: 'Small steps every day add up to a different life.', tpl: JSON.parse(JSON.stringify(TPL)) as Record<string, string[]>, seeded: true } as Settings); put(R.get('settings')!);
    if (!reseed) {
      const T = today(), dm = { demo: true };
      newNote({ ...dm, kind: 'j', title: 'Welcome to My Daily Journal', html: '<h2>Sample entry</h2><div>This is sample data. Delete it any time from Settings.</div><div><input type="checkbox"> Try a checklist</div>', tags: ['sample'] });
      newNote({ ...dm, title: 'Ideas for the week', html: '<ul><li>Review budget</li><li>Read 20 pages</li></ul>', tags: ['ideas'], cat: 'Personal', date: addD(T, -2), pin: true });
      mk('task', { ...dm, title: 'Plan the week', desc: '', due: T, prio: 'high', cat: 'Planning', done: false, notes: '', top: T }); mk('task', { ...dm, title: '30-minute study session', desc: '', due: T, prio: 'med', cat: 'Study', done: false, notes: '', top: null }); mk('task', { ...dm, title: 'Review finances', desc: '', due: addD(T, 3), prio: 'low', cat: 'Finance', done: true, notes: '', top: null });
      [['Reading', '08:00', '08:30'], ['Exercise', '17:30', '18:15'], ['Water intake', '09:00', '09:05']].forEach(([n, startTime, endTime], i) => mk('habit', { ...dm, name: n, startTime, endTime, log: { [T]: i ? 'part' : 'done', [addD(T, -1)]: 'done' } }));
      mk('goal', { ...dm, title: 'Finish a certification', desc: 'Study steadily and book the exam.', due: addD(T, 120), ms: [{ t: 'Choose exam', k: 'milestone', done: true }, { t: 'Complete course', k: 'milestone', done: false }, { t: 'Study 30 min daily', k: 'action step', done: false }] });
    }
  }
  theme(); render();
}
const store: Store = { all: () => [...R.values()], get: id => R.get(id), apply: r => { R.set(r.id, r); put(r); } };
const drop = (r: Rec) => { R.delete(r.id); if (db) try { db.transaction('rec', 'readwrite').objectStore('rec').delete(r.id); } catch { /* ignore */ } };
const schedule = () => { clearTimeout(stm); stm = setTimeout(() => { void doSync(); }, 3000); };
async function doSync(_manual?: boolean) {
  if (!Cloud.configured || !U || busy) return; if (!navigator.onLine) { st(); return; }
  if (prefs().owner && prefs().owner !== U.id) { SY = { state: 'error', msg: 'This device holds another account’s data. Export it, then clear local data in Settings before using this account.', last: SY.last }; st(); if (view == 'acct') render(); return; }
  busy = true; flush();
  try {
    if (!prefs().owner) { const demo = [...R.values()].filter(r => r.demo && !r.deleted && !r.base); if (demo.length && await sure('Remove the sample content before syncing to your account?')) demo.forEach(drop); prefs().owner = U.id; save(prefs()); }
    SY.state = 'syncing'; st();
    const r = await Cloud.sync(U.id, store);
    SY = { state: r.errors ? 'error' : 'ok', msg: `${r.pushed} sent, ${r.pulled} received${r.conflicts ? `, ${r.conflicts} conflict(s) (look for "conflict copy" notes)` : ''}${r.errors ? `, ${r.errors} failed (will retry)` : ''}`, last: Cloud.lastSync(U.id) };
    if (r.pulled || r.conflicts) { theme(); render(); }
  } catch (e) { SY = { state: 'error', msg: 'Sync failed: ' + (e instanceof Error ? e.message : e) + '. Your data is safe on this device; retrying.', last: SY.last }; }
  busy = false; st(); if (view == 'acct' || view == 'set') render();
  if (SY.state == 'error') { clearTimeout(stm); stm = setTimeout(() => { void doSync(); }, 30000); }
}

setInterval(() => { const e = $('#qt'); if (e && R.has('settings')) e.textContent = '“' + qcur() + '”'; }, 30000);
void init().then(async () => {
  if (!Cloud.configured) { st(); return; }
  const s = await Cloud.getSession(); U = s?.user || null; SY.last = U ? Cloud.lastSync(U.id) : null; st();
  Cloud.onAuth(sess => { const was = U; U = sess?.user || null; SY.last = U ? Cloud.lastSync(U.id) : null; if (U && (!was || was.id !== U.id)) void doSync(true); if (!U) SY = { state: 'idle', msg: '', last: null }; st(); if (view == 'acct') render(); });
  if (U) void doSync(); setInterval(() => { void doSync(); }, 60000); addEventListener('online', () => { void doSync(); });
});
