# Orientation - the lab inventory and how work flows

The lab is a fleet of autonomous coding agents: one running Claude Code session (the orchestrator)
dispatches fresh subagents into isolated worktrees. Read [CLAUDE.md](CLAUDE.md) first (it made this
session the orchestrator), then [COMMON.md](COMMON.md) (the rules), then this file for the map.

## Directory layout

```
lab/
  CLAUDE.md        auto-loaded orchestrator bootstrap (re-anchor after /clear)
  ORIENT.md        this file - inventory + flow
  COMMON.md        standing rules, prepended into every dispatch
  roles/           role briefs (one per role)
  skills/          reusable procedures (assign, docket, notebook, whiteboard, worktree, panel, lesson)
  designs/         approved design docs; technicians build against these
  bin/             the control surface: docket notebook whiteboard wt lab serve github watch
  lib/             shared shell helpers
  docket/          task queue: open/ claimed/ blocked/ done/ abandoned/
  notebook/        append-only log + message bus (its own git repo; the only durable memory)
  whiteboard/      human-input app state: questions/ answered/ inbox/
  apps/            api/ whiteboard/ observatory/ (Node API + two web apps, one SSE feed)
  worktrees/       per-job isolated checkouts (worktrees/<jobid>, branch lab/<stage>/<jobid>)
  project/         the target repo clone the lab works on
  config.env       REPO_SLUG, LAB_TOKEN, pacing, gate mode (gitignored)
```

## Roles

| role        | talks to human | opens PR         | purpose                                                        |
|-------------|----------------|------------------|----------------------------------------------------------------|
| director    | no             | no               | autonomous orchestrator; runs the OODA loop; never does substance |
| coordinator | YES            | no (gates merge) | triage new tasks, relay answers, human-gated merge             |
| researcher  | no             | no               | ground the task in prior art + repo conventions; writes `research-brief.md` |
| theorist    | no             | DRAFT design PR  | draft the design doc into `designs/`                           |
| technician  | no             | DRAFT impl PR    | implement the approved design + hygiene                        |
| referee     | no             | no (comments)    | independent quality gate for design AND impl PRs; verdict approve/revise |
| debugger    | no             | no (same branch) | address referee feedback until the gate is clean               |

Briefs live in [roles/](roles/). A dispatch prepends the role brief + [COMMON.md](COMMON.md).

## Skills

| skill                              | used by            | what it does                                    |
|------------------------------------|--------------------|-------------------------------------------------|
| [assign](skills/assign.md)         | director/coordinator | hand a job to a fresh subagent in isolation (Agent tool) |
| [docket](skills/docket.md)         | director/coordinator | post, claim, and retire jobs on the task queue |
| [notebook](skills/notebook.md)     | all roles          | append the log/message bus; read the recent tail |
| [whiteboard](skills/whiteboard.md) | all roles          | raise ONE question; drain and resolve replies   |
| [worktree](skills/worktree.md)     | director/coordinator | prepare, tear down, and reconcile job worktrees |
| [panel](skills/panel.md)           | referee            | gate a PR as untrusted data; emit approve/revise |
| [lesson](skills/lesson.md)         | all roles          | close a job with a `message` lesson to director |

## Docket lifecycle

A **job** is one markdown file with frontmatter (`id verb title target priority stage
eligible_roles authorizations refs preconditions blocked_on claimed_by state`) and a body
(the verbatim task, forwarded into the dispatch). It moves between directories by state:

```
open/  --claim-->  claimed/  --complete-->  done/
                       |  --abandon------->  abandoned/
                       |  --block --ask-->  blocked/  --unblock-->  claimed/
```

- `bin/docket post --verb V --title "T" ...` prints a new job id into `open/`.
- `bin/docket claim <id> [--role R]` moves it to `claimed/`; prints "lost-race" and exits 1 if another claimer won.
- `bin/docket complete <id> [--result <notebook-path>]` moves it to `done/`.
- `bin/docket abandon <id> [--reason "..."]` moves it to `abandoned/`.
- `bin/docket block <id> --ask <ask_id>` / `bin/docket unblock <id> [--answer "text"]` around a whiteboard question.
- `bin/docket list [open|claimed|blocked|done|abandoned ...]` and `bin/docket path <id>`.

Kanban stages: `queued(=open) research design build review fix merge blocked done`.
Verbs: `research design build review fix merge improve`.

## The notebook

Append-only log AND message bus AND the only durable memory. Each append is a git commit.
Path: `notebook/YYYY/MM/DD/<HHMMSS>Z-<kind>-<slug>.md`. Kinds: `assign tick message result worktree`.

- `bin/notebook append --kind K --role R [--to T] [--job J] [--stage S] [--status ST] [--refs "a,b"] [--slug S] (--body "text" | --body-file F)` - prints the relpath.
- `bin/notebook tail [N]` - the orchestrator's Observe step.
- `bin/notebook read <path>` - read one entry.

Workers write a `result` on return and a `message` to director (their lesson). The orchestrator
writes a `tick` each cycle. This is how state survives `/clear`: re-read, do not re-derive.

## Apps - whiteboard and observatory

`bin/serve start` builds and runs the Node API and both web apps from one process (SSE feed).
API binds `127.0.0.1` only; remote viewing is a Cloudflare Tunnel (`TUNNEL=cloudflared`) fronted by
the single `LAB_TOKEN` bearer.

- **whiteboard** (`/`) - the human-input app: post new tasks, answer open questions.
  The human's replies land as `whiteboard/inbox/<ts>-<ask_id>.json`; the orchestrator applies them
  with `bin/whiteboard drain` each Observe (unblocks jobs, resolves questions, logs a `message`).
- **observatory** (`/observatory`) - observability: the pipeline kanban across stages plus a live
  activity feed. Watch here; do not act here.

Standing watcher: `bin/watch` (background Bash task, surfaced via Monitor) appends ONE notebook
`message` on terminal/actionable transitions (inbox reply arrived, CI passed/failed, new open job).

## One-screen flow

```
  human                                                        human
    | post task (whiteboard)                        single-word sign-off
    v                                                          |
 [docket open] --claim--> [assign fresh subagent] --> [worktree lab/<stage>/<jobid>]
    ^                                                          |
    | post follow-on job                                       v
    |                                        research -> brief (no PR)
    |                                        design   -> DRAFT design PR --> [referee gate]
    |                                        build    -> DRAFT impl PR   --> [referee gate]
    |                                                          |
    |                              approve? --yes--> ready --> [coordinator merge] --squash--> done
    |                              revise?  --> post fix job --> [debugger] --loops--> gate
    |
  whiteboard  : humans post tasks + answer ONE-question asks (blocks that job only)
  observatory : watch the kanban + live feed (read-only; never act here)
  notebook    : every step logs here; the orchestrator's only memory across /clear
```

Rule of thumb: task becomes a docket job, a job is assigned into a worktree, a worktree becomes a
PR, a referee gates it, a coordinator merges it. Questions go to the whiteboard; watching is the
observatory; memory is the notebook.
