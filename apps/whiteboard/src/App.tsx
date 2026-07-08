import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { LabState, Question, JobView } from '@lab/shared';
import { api, AuthError, getToken, setToken, subscribe } from './lib';

export default function App() {
  const [needToken, setNeedToken] = useState(!getToken());
  const [state, setState] = useState<LabState | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await api<LabState>('/api/state'));
      setErr(null);
    } catch (e) {
      if (e instanceof AuthError) setNeedToken(true);
      else setErr(String((e as Error).message));
    }
  }, []);

  useEffect(() => {
    if (needToken) return;
    load();
    return subscribe(load);
  }, [needToken, load]);

  if (needToken) return <TokenGate onDone={() => { setNeedToken(false); }} />;

  const questions = state?.questions ?? [];
  const claimed = (state?.jobs ?? []).filter((j) => j.state === 'claimed');

  return (
    <div className="min-h-full">
      <Header connected={!!state} error={err} />
      <main className="mx-auto w-full max-w-2xl px-5 pb-24 pt-8">
        <Compose onPosted={load} />

        <section className="mt-10">
          <SectionLabel count={questions.length} tone={questions.length ? 'warn' : 'muted'}>
            Decisions {questions.length ? 'need you' : ''}
          </SectionLabel>
          {questions.length === 0 ? (
            <Calm>Nothing needs your input. The lab is working.</Calm>
          ) : (
            <div className="mt-3 space-y-3">
              {questions.map((q) => <QuestionCard key={q.ask_id} q={q} onReplied={load} />)}
            </div>
          )}
        </section>

        <section className="mt-10">
          <SectionLabel count={claimed.length} tone="muted">In progress</SectionLabel>
          {claimed.length === 0 ? (
            <Calm>Idle.</Calm>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {claimed.map((j) => <OngoingRow key={j.id} j={j} />)}
            </ul>
          )}
        </section>
      </main>
      <StatusBar state={state} />
    </div>
  );
}

function Header({ connected, error }: { connected: boolean; error: string | null }) {
  return (
    <header className="sticky top-0 z-10 border-b border-white/5 bg-black/30 backdrop-blur">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-5 py-3">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
        <h1 className="text-sm font-medium tracking-tight text-zinc-100">lab</h1>
        <span className="text-sm text-zinc-500">· whiteboard</span>
        <div className="ml-auto flex items-center gap-4 text-xs text-zinc-500">
          {error && <span className="text-red-400">{error}</span>}
          <a href="/observatory" className="transition-colors hover:text-zinc-200">observatory →</a>
        </div>
      </div>
    </header>
  );
}

function Compose({ onPosted }: { onPosted: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState(2);
  const [busy, setBusy] = useState(false);
  const canPost = title.trim().length > 0 && !busy;

  async function post() {
    if (!canPost) return;
    setBusy(true);
    try {
      await api('/api/task', { method: 'POST', body: JSON.stringify({ title, body, priority }) });
      setTitle(''); setBody(''); setPriority(2);
      onPosted();
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 shadow-2xl shadow-black/40">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What should the lab do?"
        className="w-full bg-transparent text-lg font-medium text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); }}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Details, constraints, acceptance criteria… (optional)"
        rows={3}
        className="mt-2 w-full resize-none bg-transparent text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none"
      />
      <div className="mt-3 flex items-center gap-2">
        <Segmented
          value={priority}
          onChange={setPriority}
          options={[{ v: 1, l: 'High' }, { v: 2, l: 'Normal' }, { v: 3, l: 'Low' }]}
        />
        <button
          onClick={post}
          disabled={!canPost}
          className="ml-auto rounded-lg bg-indigo-500 px-3.5 py-1.5 text-sm font-medium text-white transition enabled:hover:bg-indigo-400 disabled:opacity-40"
        >
          {busy ? 'Posting…' : 'Post task'}
        </button>
      </div>
    </div>
  );
}

function QuestionCard({ q, onReplied }: { q: Question; onReplied: () => void }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const quick = useMemo(() => {
    const found = Array.from(q.recommended.matchAll(/'([^']+)'/g)).map((m) => m[1]);
    return found.length ? found : ['yes', 'no'];
  }, [q.recommended]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api('/api/reply', { method: 'POST', body: JSON.stringify({ ask_id: q.ask_id, answer: text }) });
      setAnswer(''); onReplied();
    } finally { setBusy(false); }
  }

  return (
    <div className="animate-in rounded-2xl border border-amber-400/25 bg-amber-400/[0.04] p-4">
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded bg-amber-400/15 px-1.5 py-0.5 font-medium text-amber-300">{q.concern}</span>
        <span className="text-zinc-500">raised by {q.raised_by}</span>
        {q.job && <span className="mono ml-auto text-zinc-600">{q.job}</span>}
      </div>
      <p className="mt-2.5 text-sm leading-relaxed text-zinc-200">{q.body}</p>
      {q.recommended && (
        <p className="mt-2 text-xs text-zinc-400"><span className="text-zinc-500">recommended:</span> {q.recommended}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {quick.map((qk) => (
          <button key={qk} onClick={() => send(qk)} disabled={busy}
            className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 transition hover:border-white/25 hover:bg-white/10">
            {qk}
          </button>
        ))}
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(answer); }}
          placeholder="or type an answer…"
          className="min-w-[8rem] flex-1 rounded-md border border-white/10 bg-black/20 px-2.5 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-400/40 focus:outline-none"
        />
        <button onClick={() => send(answer)} disabled={busy || !answer.trim()}
          className="rounded-md bg-amber-400/90 px-3 py-1 text-xs font-medium text-black transition enabled:hover:bg-amber-300 disabled:opacity-40">
          Send
        </button>
      </div>
    </div>
  );
}

function OngoingRow({ j }: { j: JobView }) {
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm">
      <span className={`h-1.5 w-1.5 rounded-full ${j.error ? 'bg-red-400' : 'bg-indigo-400'} ${j.error ? '' : 'animate-pulse'}`} />
      <span className="truncate text-zinc-300">{j.title}</span>
      <span className="ml-auto shrink-0 text-xs text-zinc-500">{j.role ?? '—'} · {j.stage}</span>
    </li>
  );
}

function StatusBar({ state }: { state: LabState | null }) {
  const f = state?.fleet;
  return (
    <footer className="fixed inset-x-0 bottom-0 border-t border-white/5 bg-black/40 backdrop-blur">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-4 px-5 py-2 text-xs text-zinc-500">
        <Stat n={f?.queue ?? 0} label="queued" />
        <Stat n={f?.claimed ?? 0} label="active" />
        <Stat n={f?.blocked ?? 0} label="blocked" tone={f?.blocked ? 'warn' : undefined} />
        <Stat n={f?.done ?? 0} label="done" />
        <span className="ml-auto">{f?.activeRoles?.length ? f.activeRoles.join(' · ') : 'idle'}</span>
      </div>
    </footer>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: 'warn' }) {
  return (
    <span className={tone === 'warn' && n > 0 ? 'text-amber-400' : ''}>
      <span className="mono font-medium text-zinc-300">{n}</span> {label}
    </span>
  );
}

function Segmented<T extends number>({ value, onChange, options }:
{ value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-white/8 bg-black/20 p-0.5">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={`rounded-md px-2.5 py-1 text-xs transition ${value === o.v ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

function SectionLabel({ children, count, tone }:
{ children: ReactNode; count?: number; tone?: 'warn' | 'muted' }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className={`text-xs font-medium uppercase tracking-wider ${tone === 'warn' ? 'text-amber-400' : 'text-zinc-500'}`}>{children}</h2>
      {typeof count === 'number' && count > 0 && (
        <span className="mono rounded-full bg-white/5 px-1.5 text-[10px] text-zinc-400">{count}</span>
      )}
    </div>
  );
}

function Calm({ children }: { children: ReactNode }) {
  return <p className="mt-3 rounded-xl border border-white/5 bg-white/[0.015] px-4 py-6 text-center text-sm text-zinc-600">{children}</p>;
}

function TokenGate({ onDone }: { onDone: () => void }) {
  const [t, setT] = useState('');
  const [checking, setChecking] = useState(false);
  const [bad, setBad] = useState(false);

  async function submit() {
    if (!t.trim()) return;
    setChecking(true); setBad(false);
    setToken(t);
    try {
      await api('/api/state');
      onDone();
    } catch {
      setBad(true);
    } finally { setChecking(false); }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-5">
      <div className="w-full max-w-sm animate-in rounded-2xl border border-white/8 bg-white/[0.02] p-6">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-indigo-400" />
          <h1 className="text-sm font-medium text-zinc-100">lab · whiteboard</h1>
        </div>
        <p className="mt-3 text-sm text-zinc-500">Enter your lab token to connect.</p>
        <input
          type="password" value={t} autoFocus
          onChange={(e) => setT(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="LAB_TOKEN"
          className="mono mt-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-400/50 focus:outline-none"
        />
        {bad && <p className="mt-2 text-xs text-red-400">Token rejected.</p>}
        <button onClick={submit} disabled={checking || !t.trim()}
          className="mt-4 w-full rounded-lg bg-indigo-500 py-2 text-sm font-medium text-white transition enabled:hover:bg-indigo-400 disabled:opacity-40">
          {checking ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </div>
  );
}
