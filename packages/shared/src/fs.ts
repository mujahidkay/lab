// @lab/shared/fs — Node-only readers over the lab filesystem. Imported by the
// API. Never import this from browser code (it uses node:fs).

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFrontmatter, deriveJobView,
  type Job, type JobState, type NotebookEntry, type Question,
  type JobView, type LabState, type FleetSummary, type Verb, type NotebookKind,
} from './index.js';

const JOB_STATES: JobState[] = ['open', 'claimed', 'blocked', 'done', 'abandoned'];

/** Resolve the lab root: $LAB_ROOT, else walk up from this file to find bin/docket. */
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

export function paths(root = labRoot()) {
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

export function listJobs(root = labRoot()): Job[] {
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

export function listNotebook(limit = 200, root = labRoot()): NotebookEntry[] {
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

export function listQuestions(root = labRoot()): Question[] {
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

export function buildJobViews(root = labRoot()): JobView[] {
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

export function buildState(recentN = 60, root = labRoot()): LabState {
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
