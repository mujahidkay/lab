// @lab/shared/fs — Node-only readers over the lab filesystem. Imported by the
// API. Never import this from browser code (it uses node:fs).

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFrontmatter, deriveJobView,
  type Job, type JobState, type NotebookEntry, type Question,
  type JobView, type LabState, type FleetSummary, type Verb, type NotebookKind,
  type InstanceSummary, type AggregateEntry, type AggregateView,
} from './index.js';

const JOB_STATES: JobState[] = ['open', 'claimed', 'blocked', 'done', 'abandoned'];

/** Resolve the CODE root: $LAB_ROOT, else walk up from this file to find bin/docket. */
export function labRoot(): string {
  if (process.env.LAB_ROOT) return process.env.LAB_ROOT;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'bin', 'docket'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

/** Resolve the MUTABLE state root, mirroring lib/common.sh's resolution order:
 *   $LAB_STATE, else $LAB_ROOT/instances/$LAB_INSTANCE, else the code root.
 *  (NB: labRoot() honors an inherited $LAB_ROOT while common.sh always recomputes
 *  it from the lib/ location; the launch path — bin/serve — exports both LAB_ROOT
 *  and LAB_STATE, so the two agree. A TS caller launched without LAB_STATE must
 *  ensure $LAB_ROOT points at the real checkout.) */
export function stateRoot(): string {
  if (process.env.LAB_STATE) return process.env.LAB_STATE;
  if (process.env.LAB_INSTANCE) return join(labRoot(), 'instances', process.env.LAB_INSTANCE);
  return labRoot();
}

/** The directory that holds per-instance state trees (instances/<name>/). */
export function instancesDir(): string {
  return join(labRoot(), 'instances');
}

export function paths(root = stateRoot()) {
  return {
    root,
    docket: join(root, 'docket'),
    notebook: join(root, 'notebook'),
    whiteboard: join(root, 'whiteboard'),
    worktrees: join(root, 'worktrees'),
  };
}

function readMd(file: string) { return parseFrontmatter(readFileSync(file, 'utf8')); }

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (v == null || v === '') return [];
  return [String(v)];
}

function toJob(file: string, state: JobState): Job {
  const { data, body } = readMd(file);
  const id = String(data.id ?? basename(file).replace(/\.md$/, ''));
  return {
    id,
    verb: (data.verb as Verb) ?? 'build',
    title: String(data.title ?? id),
    target: String(data.target ?? ''),
    priority: typeof data.priority === 'number' ? data.priority : parseInt(String(data.priority ?? 2), 10) || 2,
    stage: String(data.stage ?? ''),
    eligible_roles: asArray(data.eligible_roles),
    authorizations: asArray(data.authorizations),
    refs: asArray(data.refs),
    preconditions: asArray(data.preconditions),
    blocked_on: (data.blocked_on as string | null) ?? null,
    claimed_by: (data.claimed_by as string | null) ?? null,
    claimed_at: (data.claimed_at as string | null) ?? null,
    posted_at: String(data.posted_at ?? ''),
    state,
    body: body.trim(),
  };
}

export function listJobs(root = stateRoot()): Job[] {
  const p = paths(root);
  const jobs: Job[] = [];
  for (const state of JOB_STATES) {
    const dir = join(p.docket, state);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      try { jobs.push(toJob(join(dir, f), state)); } catch { /* skip malformed */ }
    }
  }
  return jobs;
}

function walkMd(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkMd(full));
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

export function listNotebook(limit = 200, root = stateRoot()): NotebookEntry[] {
  const p = paths(root);
  const files = walkMd(p.notebook).sort(); // path encodes date/time -> chronological
  const recent = files.slice(-limit);
  const entries: NotebookEntry[] = [];
  for (const f of recent) {
    try {
      const { data, body } = readMd(f);
      entries.push({
        path: f.slice(p.notebook.length + 1),
        ts: String(data.ts ?? ''),
        kind: (data.kind as NotebookKind) ?? 'message',
        role: String(data.role ?? '?'),
        to: data.to ? String(data.to) : undefined,
        job: data.job ? String(data.job) : undefined,
        stage: data.stage ? String(data.stage) : undefined,
        status: data.status ? String(data.status) : undefined,
        refs: asArray(data.refs),
        body: body.trim(),
      });
    } catch { /* skip */ }
  }
  return entries.sort((a, b) => a.ts.localeCompare(b.ts));
}

export function listQuestions(root = stateRoot()): Question[] {
  const dir = join(paths(root).whiteboard, 'questions');
  if (!existsSync(dir)) return [];
  const qs: Question[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    try {
      const { data, body } = readMd(join(dir, f));
      qs.push({
        ask_id: String(data.ask_id ?? f.replace(/\.md$/, '')),
        concern: String(data.concern ?? ''),
        raised_by: String(data.raised_by ?? ''),
        job: String(data.job ?? ''),
        recommended: String(data.recommended ?? ''),
        ts: String(data.ts ?? ''),
        status: String(data.status ?? 'open'),
        body: body.trim(),
      });
    } catch { /* skip */ }
  }
  return qs.sort((a, b) => a.ts.localeCompare(b.ts));
}

export function buildJobViews(root = stateRoot()): JobView[] {
  const jobs = listJobs(root);
  const notebook = listNotebook(500, root);
  const byJob = new Map<string, NotebookEntry[]>();
  for (const e of notebook) {
    if (!e.job) continue;
    (byJob.get(e.job) ?? byJob.set(e.job, []).get(e.job)!).push(e);
  }
  return jobs
    .map((j) => deriveJobView(j, byJob.get(j.id) ?? []))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function buildState(recentN = 60, root = stateRoot()): LabState {
  const views = buildJobViews(root);
  const questions = listQuestions(root).filter((q) => q.status === 'open');
  const recent = listNotebook(recentN, root).slice().reverse();

  const count = (s: JobState) => views.filter((v) => v.state === s).length;
  const activeRoles = Array.from(
    new Set(views.filter((v) => v.state === 'claimed' && v.role).map((v) => v.role!)),
  );
  const lastTick = [...recent].find((e) => e.kind === 'tick')?.ts;

  const fleet: FleetSummary = {
    queue: count('open'),
    claimed: count('claimed'),
    blocked: count('blocked'),
    done: count('done'),
    abandoned: count('abandoned'),
    openQuestions: questions.length,
    activeRoles,
    lastTick,
  };
  return { fleet, jobs: views, questions, recent };
}

// --- cross-instance aggregate ------------------------------------------------
// Every instance's state lives under $LAB_ROOT/instances/<name>/, and the whole
// checkout is bind-mounted into every container, so any instance's API can read
// its siblings here. This is READ-ONLY: it never writes and never reads secrets.

/** Parse a KEY=VALUE env file, returning ONLY the whitelisted keys. Secrets
 *  (LAB_TOKEN, LAB_GH_TOKEN) are never in the whitelist, so never read out.
 *  Strips an unquoted trailing `# comment` to match how `. config.env` (bash)
 *  sources the same file — config.env.example ships inline comments. */
function readEnvWhitelist(file: string, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return out; }
  for (const raw of text.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw.trim());
    if (!m || !keys.includes(m[1])) continue;
    let v = m[2].trim();
    if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '').trim();   // drop unquoted trailing comment
    out[m[1]] = v.replace(/^["']|["']$/g, '');
  }
  return out;
}

/** State root of every instance: each subdir of instances/ that has docket/ or
 *  notebook/, PLUS the current state root when it lives OUTSIDE instances/ (flat
 *  or legacy-root mode) so an active instance is never invisible in the aggregate. */
function instanceRoots(): { name: string; root: string }[] {
  const dir = instancesDir();
  const out: { name: string; root: string }[] = [];
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const root = join(dir, name);
      try { if (!statSync(root).isDirectory()) continue; } catch { continue; }
      if (existsSync(join(root, 'docket')) || existsSync(join(root, 'notebook'))) out.push({ name, root });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  const sr = stateRoot();
  const inside = sr === dir || sr.startsWith(dir + sep);
  if (!inside && !out.some((o) => o.root === sr) &&
      (existsSync(join(sr, 'docket')) || existsSync(join(sr, 'notebook')))) {
    out.unshift({ name: process.env.LAB_INSTANCE || basename(sr) || 'local', root: sr });
  }
  return out;
}

/** Build one instance's summary from its docket + a (pre-walked) notebook slice. */
function summarizeInstance(name: string, root: string, entries: NotebookEntry[]): InstanceSummary {
  const env = readEnvWhitelist(join(root, 'config.env'), ['REPO_SLUG', 'LAB_GH_USER', 'DASH_PORT']);
  const repo = env.REPO_SLUG || '';
  const user = env.LAB_GH_USER || '';
  const work = repo && user ? `${user}/${repo.split('/').pop()}` : '';
  const port = env.DASH_PORT ? parseInt(env.DASH_PORT, 10) || undefined : undefined;
  const jobs = listJobs(root);
  const count = (s: JobState) => jobs.filter((j) => j.state === s).length;
  return {
    name, repo, work, port,
    open: count('open'), claimed: count('claimed'), blocked: count('blocked'),
    done: count('done'), abandoned: count('abandoned'),
    lastActivity: entries.length ? entries[entries.length - 1].ts : undefined,  // listNotebook is ts-ascending
  };
}

export function listInstances(): InstanceSummary[] {
  return instanceRoots().map(({ name, root }) => summarizeInstance(name, root, listNotebook(1, root)));
}

/** Recent notebook entries merged across ALL instances, newest first, each
 *  tagged with its instance name. */
export function aggregateEntries(perInstance = 120, total = 200): AggregateEntry[] {
  const all: AggregateEntry[] = [];
  for (const { name, root } of instanceRoots()) {
    for (const e of listNotebook(perInstance, root)) all.push({ ...e, instance: name });
  }
  all.sort((a, b) => b.ts.localeCompare(a.ts));
  return all.slice(0, total);
}

/** The polled endpoint: summaries + merged feed, walking each instance's
 *  notebook exactly ONCE (summary lastActivity is derived from the same slice). */
export function buildAggregate(perInstance = 120, total = 200): AggregateView {
  const instances: InstanceSummary[] = [];
  const all: AggregateEntry[] = [];
  for (const { name, root } of instanceRoots()) {
    const entries = listNotebook(perInstance, root);
    instances.push(summarizeInstance(name, root, entries));
    for (const e of entries) all.push({ ...e, instance: name });
  }
  all.sort((a, b) => b.ts.localeCompare(a.ts));
  return { instances, recent: all.slice(0, total) };
}
