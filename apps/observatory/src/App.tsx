import { useCallback, useEffect, useState } from 'react';
import {
  STAGES, STAGE_LABEL,
  type LabState, type JobView, type NotebookEntry, type Stage,
  type AggregateView, type AggregateEntry, type InstanceSummary,
} from '@lab/shared';
import { api, AuthError, getToken, setToken, subscribe } from './lib';

const STAGE_ACCENT: Record<Stage, string> = {
  queued: 'bg-zinc-500', research: 'bg-sky-400', design: 'bg-violet-400',
  build: 'bg-indigo-400', review: 'bg-amber-400', fix: 'bg-orange-400',
  merge: 'bg-emerald-400', blocked: 'bg-red-400', done: 'bg-zinc-600',
};
const KIND_COLOR: Record<string, string> = {
  assign: 'text-indigo-300 bg-indigo-400/10', tick: 'text-zinc-500',
  result: 'text-emerald-300 bg-emerald-400/10', message: 'text-sky-300 bg-sky-400/10',
  worktree: 'text-violet-300 bg-violet-400/10',
};

type View = 'repo' | 'all';

export default function App() {
  const [needToken, setNeedToken] = useState(!getToken());
  const [view, setView] = useState<View>('repo');
  const [state, setState] = useState<LabState | null>(null);
  const [agg, setAgg] = useState<AggregateView | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setState(await api<LabState>('/api/state')); }
    catch (e) { if (e instanceof AuthError) setNeedToken(true); }
  }, []);

  const loadAgg = useCallback(async () => {
    try { setAgg(await api<AggregateView>('/api/aggregate')); }
    catch (e) { if (e instanceof AuthError) setNeedToken(true); }
  }, []);

  // This repo: SSE reflects this instance, so re-load on any change. No polling.
  useEffect(() => {
    if (needToken || view !== 'repo') return;
    load();
    return subscribe(load);
  }, [needToken, view, load]);

  // All repos: SSE only covers this instance, so poll the aggregate every 4s.
  useEffect(() => {
    if (needToken || view !== 'all') return;
    loadAgg();
    const id = setInterval(loadAgg, 4000);
    return () => clearInterval(id);
  }, [needToken, view, loadAgg]);

  if (needToken) return <TokenGate onDone={() => setNeedToken(false)} />;

  return (
    <div className="flex h-full flex-col">
      <Header view={view} onView={setView} />
      {view === 'all'
        ? <AllRepos agg={agg} />
        : <RepoView state={state} focus={focus} onFocus={setFocus} />}
    </div>
  );
}

function RepoView({ state, focus, onFocus }:
{ state: LabState | null; focus: string | null; onFocus: (id: string | null) => void }) {
  const jobs = state?.jobs ?? [];
  const columns = STAGES.filter((s) => s !== 'done' || jobs.some((j) => j.stage === 'done'));
  return (
    <>
      <FleetBar state={state} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 min-w-0 flex-1 overflow-x-auto">
          <div className="flex h-full gap-3 p-4">
            {columns.map((s) => (
              <Column key={s} stage={s} jobs={jobs.filter((j) => j.stage === s)}
                focus={focus} onFocus={onFocus} />
            ))}
          </div>
        </div>
        <LiveFeed entries={state?.recent ?? []} focus={focus} onClear={() => onFocus(null)} />
      </div>
    </>
  );
}

function Header({ view, onView }: { view: View; onView: (v: View) => void }) {
  return (
    <header className="flex items-center gap-3 border-b border-white/5 px-5 py-3">
      <span className="h-2 w-2 rounded-full bg-emerald-400" />
      <h1 className="text-sm font-medium text-zinc-100">lab</h1>
      <span className="text-sm text-zinc-500">· observatory</span>
      <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-white/8 bg-white/[0.02] p-0.5 text-[11px]">
        <ViewTab active={view === 'repo'} onClick={() => onView('repo')}>This repo</ViewTab>
        <ViewTab active={view === 'all'} onClick={() => onView('all')}>All repos</ViewTab>
      </div>
      <a href="/" className="text-xs text-zinc-500 transition-colors hover:text-zinc-200">← whiteboard</a>
    </header>
  );
}

function ViewTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button onClick={onClick}
      className={`rounded-md px-2 py-1 transition ${active ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
      {children}
    </button>
  );
}

function FleetBar({ state }: { state: LabState | null }) {
  const f = state?.fleet;
  const errors = (state?.jobs ?? []).filter((j) => j.error).length;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-white/5 px-5 py-2 text-xs text-zinc-500">
      <Metric n={f?.queue ?? 0} label="queued" />
      <Metric n={f?.claimed ?? 0} label="active" tone="indigo" />
      <Metric n={f?.blocked ?? 0} label="blocked" tone={f?.blocked ? 'amber' : undefined} />
      <Metric n={errors} label="errors" tone={errors ? 'red' : undefined} />
      <Metric n={f?.done ?? 0} label="done" />
      <span className="ml-auto flex items-center gap-3">
        <span>{f?.activeRoles?.length ? f.activeRoles.join(' · ') : 'idle'}</span>
        {f?.lastTick && <span className="text-zinc-600">tick {timeOf(f.lastTick)}</span>}
      </span>
    </div>
  );
}

function Metric({ n, label, tone }: { n: number; label: string; tone?: 'indigo' | 'amber' | 'red' }) {
  const c = tone === 'red' ? 'text-red-400' : tone === 'amber' ? 'text-amber-400' : tone === 'indigo' ? 'text-indigo-300' : 'text-zinc-300';
  return <span><span className={`mono font-semibold ${n ? c : 'text-zinc-600'}`}>{n}</span> {label}</span>;
}

function Column({ stage, jobs, focus, onFocus }:
{ stage: Stage; jobs: JobView[]; focus: string | null; onFocus: (id: string | null) => void }) {
  return (
    <div className="flex w-64 shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={`h-1.5 w-1.5 rounded-full ${STAGE_ACCENT[stage]}`} />
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">{STAGE_LABEL[stage]}</span>
        <span className="mono ml-auto text-[10px] text-zinc-600">{jobs.length}</span>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto pr-1">
        {jobs.map((j) => <Card key={j.id} j={j} focused={focus === j.id} onClick={() => onFocus(focus === j.id ? null : j.id)} />)}
        {jobs.length === 0 && <div className="rounded-lg border border-dashed border-white/5 py-6" />}
      </div>
    </div>
  );
}

function Card({ j, focused, onClick }: { j: JobView; focused: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`animate-in w-full rounded-xl border p-3 text-left transition ${
        focused ? 'border-indigo-400/60 bg-indigo-400/[0.06]' : 'border-white/8 bg-white/[0.02] hover:border-white/20'}`}>
      <div className="flex items-start gap-2">
        <p className="line-clamp-2 flex-1 text-sm text-zinc-200">{j.title}</p>
        {j.error && <span title="error" className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-red-400" />}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
        {j.role && <span className="rounded bg-white/5 px-1.5 py-0.5 text-zinc-300">{j.role}</span>}
        <span className="mono truncate">{j.id.split('-').pop()}</span>
        <span className="ml-auto">{relTime(j.updatedAt)}</span>
      </div>
      {(j.pr || j.blockedOn) && (
        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
          {j.pr && <span className="mono text-indigo-300">{prShort(j.pr)}</span>}
          {j.blockedOn && <span className="text-amber-400">awaiting answer</span>}
        </div>
      )}
    </button>
  );
}

function LiveFeed({ entries, focus, onClear }:
{ entries: NotebookEntry[]; focus: string | null; onClear: () => void }) {
  const shown = focus ? entries.filter((e) => e.job === focus) : entries;
  return (
    <aside className="flex min-h-0 w-full flex-col border-t border-white/5 lg:w-96 lg:shrink-0 lg:border-l lg:border-t-0">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">Live feed</span>
        {focus && (
          <button onClick={onClear} className="mono ml-auto rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200">
            {focus.split('-').pop()} ✕
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-px overflow-y-auto px-2 pb-4">
        {shown.length === 0 && <p className="px-2 py-6 text-center text-xs text-zinc-600">No activity yet.</p>}
        {shown.map((e) => <FeedRow key={e.path} e={e} />)}
      </div>
    </aside>
  );
}

function FeedRow({ e }: { e: NotebookEntry }) {
  const first = e.body.split('\n').find((l) => l.trim()) ?? '';
  return (
    <div className="animate-in rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="mono text-zinc-600">{timeOf(e.ts)}</span>
        <span className={`rounded px-1.5 py-0.5 font-medium ${KIND_COLOR[e.kind] ?? 'text-zinc-500'}`}>{e.kind}</span>
        <span className="text-zinc-400">{e.role}{e.to ? ` → ${e.to}` : ''}</span>
        {e.stage && <span className="ml-auto text-zinc-600">{e.stage}</span>}
      </div>
      {first && <p className="mt-0.5 line-clamp-2 pl-1 text-xs text-zinc-400">{first}</p>}
    </div>
  );
}

function AllRepos({ agg }: { agg: AggregateView | null }) {
  const loading = agg === null;               // null = first poll not back yet
  const instances = agg?.instances ?? [];
  const recent = agg?.recent ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="py-16 text-center text-sm text-zinc-600">Loading…</div>
        ) : instances.length === 0 ? (
          <div className="animate-in rounded-xl border border-dashed border-white/8 py-16 text-center text-sm text-zinc-600">
            No instances yet — run <span className="mono text-zinc-400">./labctl init &lt;name&gt;</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {instances.map((i) => <InstanceCard key={i.name} i={i} />)}
          </div>
        )}
      </div>
      <AggregateFeed entries={recent} />
    </div>
  );
}

function InstanceCard({ i }: { i: InstanceSummary }) {
  const repo = i.work || i.repo || '—';
  const dash = i.port ? `//${window.location.hostname}:${i.port}/observatory` : null;
  return (
    <div className="animate-in rounded-xl border border-white/8 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2">
        <span className="mono text-sm font-medium text-zinc-100">{i.name}</span>
        {dash && (
          <a href={dash} target="_blank" rel="noreferrer"
            className="mono ml-auto text-[10px] text-zinc-500 transition-colors hover:text-indigo-300">
            dashboard ↗
          </a>
        )}
      </div>
      <p className="mono mt-0.5 truncate text-xs text-zinc-500">{repo}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        <Metric n={i.open} label="open" />
        <Metric n={i.claimed} label="active" tone="indigo" />
        <Metric n={i.blocked} label="blocked" tone={i.blocked ? 'amber' : undefined} />
        <Metric n={i.done} label="done" />
      </div>
      {i.lastActivity && (
        <p className="mt-2 text-[11px] text-zinc-600">last activity {relTime(i.lastActivity)} ago</p>
      )}
    </div>
  );
}

function AggregateFeed({ entries }: { entries: AggregateEntry[] }) {
  return (
    <aside className="flex min-h-0 w-full flex-col border-t border-white/5 lg:w-96 lg:shrink-0 lg:border-l lg:border-t-0">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">All activity</span>
      </div>
      <div className="min-h-0 flex-1 space-y-px overflow-y-auto px-2 pb-4">
        {entries.length === 0 && <p className="px-2 py-6 text-center text-xs text-zinc-600">No activity yet.</p>}
        {entries.map((e) => <AggFeedRow key={`${e.instance}:${e.path}`} e={e} />)}
      </div>
    </aside>
  );
}

function AggFeedRow({ e }: { e: AggregateEntry }) {
  const first = e.body.split('\n').find((l) => l.trim()) ?? '';
  return (
    <div className="animate-in rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="mono text-zinc-600">{timeOf(e.ts)}</span>
        <span className={`rounded px-1.5 py-0.5 font-medium ${KIND_COLOR[e.kind] ?? 'text-zinc-500'}`}>{e.kind}</span>
        <span className="mono rounded bg-white/5 px-1 py-0.5 text-zinc-400">{e.instance}</span>
        <span className="truncate text-zinc-400">{e.role}{e.to ? ` → ${e.to}` : ''}</span>
        {e.stage && <span className="ml-auto shrink-0 text-zinc-600">{e.stage}</span>}
      </div>
      {first && <p className="mt-0.5 line-clamp-2 pl-1 text-xs text-zinc-400">{first}</p>}
    </div>
  );
}

// --- time helpers ---
function timeOf(iso: string) { const d = new Date(iso); return isNaN(+d) ? '' : d.toLocaleTimeString([], { hour12: false }); }
function relTime(iso: string) {
  const t = +new Date(iso); if (isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`; if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`; return `${Math.round(s / 86400)}d`;
}
function prShort(pr: string) { const m = /\/pull\/(\d+)/.exec(pr); return m ? `PR#${m[1]}` : pr; }

function TokenGate({ onDone }: { onDone: () => void }) {
  const [t, setT] = useState('');
  const [bad, setBad] = useState(false);
  async function submit() {
    if (!t.trim()) return;
    setToken(t); setBad(false);
    try { await api('/api/state'); onDone(); } catch { setBad(true); }
  }
  return (
    <div className="flex h-full items-center justify-center px-5">
      <div className="w-full max-w-sm animate-in rounded-2xl border border-white/8 bg-white/[0.02] p-6">
        <h1 className="text-sm font-medium text-zinc-100">lab · observatory</h1>
        <p className="mt-3 text-sm text-zinc-500">Enter your lab token to connect.</p>
        <input type="password" value={t} autoFocus
          onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="LAB_TOKEN"
          className="mono mt-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-400/50 focus:outline-none" />
        {bad && <p className="mt-2 text-xs text-red-400">Token rejected.</p>}
        <button onClick={submit} disabled={!t.trim()}
          className="mt-4 w-full rounded-lg bg-indigo-500 py-2 text-sm font-medium text-white transition enabled:hover:bg-indigo-400 disabled:opacity-40">
          Connect
        </button>
      </div>
    </div>
  );
}
