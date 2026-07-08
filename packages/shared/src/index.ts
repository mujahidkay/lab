// @lab/shared — domain types + PURE helpers (no Node built-ins here, so the
// React apps can import from '@lab/shared' safely). Node-only filesystem
// readers live in './fs'.

export type Role =
  | 'director' | 'coordinator' | 'researcher'
  | 'theorist' | 'technician' | 'referee' | 'debugger';

export type Verb = 'research' | 'design' | 'build' | 'review' | 'fix' | 'merge' | 'improve';

export type JobState = 'open' | 'claimed' | 'blocked' | 'done' | 'abandoned';

// Kanban columns, left to right.
export type Stage =
  | 'queued' | 'research' | 'design' | 'build' | 'review' | 'fix' | 'merge' | 'blocked' | 'done';

export const STAGES: Stage[] = [
  'queued', 'research', 'design', 'build', 'review', 'fix', 'merge', 'blocked', 'done',
];

export const STAGE_LABEL: Record<Stage, string> = {
  queued: 'Queued', research: 'Research', design: 'Design', build: 'Build',
  review: 'Review', fix: 'Fix', merge: 'Merge', blocked: 'Blocked', done: 'Done',
};

export type TokenName = 'push' | 'open-pr' | 'review-comment' | 'merge' | 'identity';
export type NotebookKind = 'assign' | 'tick' | 'message' | 'result' | 'worktree';

export interface Job {
  id: string;
  verb: Verb;
  title: string;
  target: string;
  priority: number;
  stage: string;
  eligible_roles: string[];
  authorizations: string[];
  refs: string[];
  preconditions: string[];
  blocked_on: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  posted_at: string;
  state: JobState;
  body: string;
}

export interface NotebookEntry {
  path: string;
  ts: string;
  kind: NotebookKind;
  role: string;
  to?: string;
  job?: string;
  stage?: string;
  status?: string;
  refs: string[];
  body: string;
}

export interface Question {
  ask_id: string;
  concern: string;
  raised_by: string;
  job: string;
  recommended: string;
  ts: string;
  status: string;
  body: string;
}

export interface JobView {
  id: string;
  title: string;
  verb: Verb;
  stage: Stage;
  state: JobState;
  role?: string;
  priority: number;
  target: string;
  pr?: string;
  blockedOn?: string | null;
  error: boolean;
  postedAt: string;
  updatedAt: string;
  history: NotebookEntry[];
}

export interface FleetSummary {
  queue: number;
  claimed: number;
  blocked: number;
  done: number;
  abandoned: number;
  openQuestions: number;
  activeRoles: string[];
  lastTick?: string;
}

export interface LabState {
  fleet: FleetSummary;
  jobs: JobView[];
  questions: Question[];
  recent: NotebookEntry[];
}

export type LabEvent =
  | { type: 'hello'; ts: string }
  | { type: 'change'; area: 'docket' | 'notebook' | 'whiteboard'; ts: string };

// --- pure frontmatter parser -------------------------------------------------
// Handles the lab's simple `key: value` blocks: quoted strings, [a, b] lists,
// null, and integers. Not a general YAML parser (by design).

export interface Parsed { data: Record<string, unknown>; body: string; }

export function parseFrontmatter(text: string): Parsed {
  const norm = text.replace(/\r\n/g, '\n');
  const data: Record<string, unknown> = {};
  if (!norm.startsWith('---\n')) return { data, body: norm };
  const end = norm.indexOf('\n---', 3);
  if (end === -1) return { data, body: norm };
  const fm = norm.slice(4, end);
  const body = norm.slice(end + 4).replace(/^\n/, '');
  for (const line of fm.split('\n')) {
    const m = /^([A-Za-z0-9_]+):\s?(.*)$/.exec(line);
    if (!m) continue;
    data[m[1]] = coerce(m[2]);
  }
  return { data, body };
}

function coerce(raw: string): unknown {
  const v = raw.trim();
  if (v === '' || v === 'null' || v === '~') return null;
  if (/^\[.*\]$/.test(v)) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => unquote(s.trim())).filter((s) => s !== '');
  }
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  return unquote(v);
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// --- pure derivations --------------------------------------------------------

const VERB_STAGE: Record<Verb, Stage> = {
  research: 'research', design: 'design', build: 'build',
  review: 'review', fix: 'fix', merge: 'merge', improve: 'build',
};

function asStage(s: string | undefined, fallback: Stage): Stage {
  return s && (STAGES as string[]).includes(s) ? (s as Stage) : fallback;
}

/** Find a PR reference like "PR#41" or a github pull URL in text. */
export function findPr(text: string): string | undefined {
  const url = /https?:\/\/github\.com\/[^\s)]+\/pull\/\d+/.exec(text);
  if (url) return url[0];
  const short = /PR#(\d+)/.exec(text);
  return short ? `PR#${short[1]}` : undefined;
}

/** Derive the kanban view of a job from the job + its notebook history. */
export function deriveJobView(job: Job, history: NotebookEntry[]): JobView {
  const sorted = [...history].sort((a, b) => a.ts.localeCompare(b.ts));
  const last = sorted[sorted.length - 1];

  let stage: Stage;
  if (job.state === 'done' || job.state === 'abandoned') stage = 'done';
  else if (job.state === 'blocked') stage = 'blocked';
  else if (job.state === 'open' && !job.claimed_at) stage = 'queued';
  else stage = asStage(last?.stage ?? job.stage, VERB_STAGE[job.verb] ?? 'build');

  const error = sorted.some((e) => e.kind === 'result' && e.status === 'error');
  const role = job.claimed_by ?? last?.role;

  let pr: string | undefined;
  for (const e of sorted) {
    pr = findPr([e.body, ...(e.refs ?? [])].join(' ')) ?? pr;
  }
  pr = pr ?? findPr([job.body, ...(job.refs ?? [])].join(' '));

  const updatedAt = last?.ts ?? job.claimed_at ?? job.posted_at;
  return {
    id: job.id, title: job.title, verb: job.verb, stage, state: job.state,
    role: role ?? undefined, priority: job.priority, target: job.target,
    pr, blockedOn: job.blocked_on, error,
    postedAt: job.posted_at, updatedAt, history: sorted,
  };
}
