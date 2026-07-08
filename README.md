# lab

A fleet of autonomous coding agents. A simpler, faithful clone of [kriskowal/garden](https://github.com/kriskowal/garden).

## What the lab is

You post work and answer questions on the **whiteboard**. You watch progress on the **observatory**. Agents do the coding autonomously in between.

One long-running Claude Code session is the **director**. It runs an OODA loop, dispatches each unit of work to a fresh subagent (via the Agent tool, in an isolated git worktree), and self-paces with ScheduleWakeup. It never does substance itself and never talks to you directly. The **coordinator** posture is the only one that talks to you: it triages your tasks, relays answers, and does the human-gated merge.

```
   you                      apps (Node API + SSE)          the session
 ┌──────┐   post task     ┌──────────────────────┐      ┌───────────────┐
 │      │ ──────────────► │  whiteboard   /       │ ───► │   director    │
 │ human│   answer Q      │  (post + answer)      │      │  OODA loop    │
 │      │ ◄────────────── │                       │      │  ├ Agent tool │──► researcher
 └──────┘                 │  observatory /observ. │ ◄─── │  ├ subagents  │──► theorist
     ▲                    │  (kanban + feed)      │      │  └ ScheduleWk │──► technician
     │  review + approve  └──────────────────────┘      └───────┬───────┘   referee / debugger
     │       PRs                                                │
     └──────────────────────  GitHub  ◄──────────────────────── │ draft PRs, notebook, worktrees
                          (target repo)
```

You interact through the two apps and GitHub. You do **not** drive the lab CLI. `bin/*` is the agents' surface, not yours (except for one-time setup below).

## Requirements

- **Claude Code** (`claude`) - the session that runs everything.
- **Node.js >= 18** - the API and both apps.
- **Yarn 4** - via Corepack (shipped with Node). If `yarn` is missing, run `corepack enable`.
- **git >= 2.5** - worktrees (`git worktree`) are load-bearing.
- **`gh`** authenticated with **repo + workflow** scopes: `gh auth login`, then `gh auth status`.
- A **target GitHub repo** the lab works on. Use a **SANDBOX repo**. Strongly recommended. The lab pushes branches and opens PRs against it.
- **`cloudflared`** - optional. Only for remote viewing from another device.

## Install

```sh
cd lab/
chmod +x bin/*
yarn install
cp config.env.example config.env
```

## Configure

Edit `config.env` (gitignored). Keys that matter first:

- `REPO_SLUG` - the target repo as `owner/name`. Point it at a sandbox.
- `DASH_PORT` - the port the API and apps bind (default `8787`). Bind stays `127.0.0.1`.
- `GATE_MODE` - `solo` (one referee) or `panel` (judge + small juror panel).
- Loop bounds - `ACTIVE_MIN` / `ACTIVE_MAX` / `IDLE_MIN` / `IDLE_MAX` (seconds). The director never picks exactly 300.

Turn on **branch protection** on the target's default branch (require a PR, require review). The lab opens draft PRs and never pushes the default branch, but protection is your backstop.

## Initialize

```sh
bin/lab init
```

This generates `LAB_TOKEN` (48 hex chars; treat it like a password), clones `REPO_SLUG` into `project/`, git-inits `notebook/` as its own repo, makes the `docket/`, `whiteboard/`, `worktrees/`, and `.lab/` directories, and reconciles any stale worktrees. If `REPO_SLUG` is still a placeholder it warns and skips the clone. Fix it and re-run.

Rotate the token any time with `bin/lab init --rotate-token`. Check setup with `bin/lab status`.

## Start

```sh
bin/serve start
```

Builds the workspace, then runs the Node API plus the whiteboard and observatory apps. With `TUNNEL=cloudflared` in `config.env` it also starts a Cloudflare Tunnel, prints the public HTTPS URL, and writes it to `.lab/tunnel-url`.

Then open a Claude Code session in `lab/` and say:

> start the lab

`CLAUDE.md` is auto-loaded and makes that session the director. On boot it runs `bin/serve start` (idempotent), starts the standing watcher `bin/watch`, runs `bin/wt reconcile`, and begins the loop.

Stop the apps with `bin/serve stop`.

## Use it

**Locally**: whiteboard at `http://127.0.0.1:<DASH_PORT>/`, observatory at `http://127.0.0.1:<DASH_PORT>/observatory`.

**Remotely**: open the tunnel URL (from `.lab/tunnel-url`) on any device and enter `LAB_TOKEN` once. It gates every endpoint.

Then:

1. **Post a task** on the whiteboard.
2. **Watch** the kanban and the live feed on the observatory. Stages: `queued research design build review fix merge blocked done`.
3. **Answer questions** in the reply box when a worker raises one. That unblocks the job.
4. **Review and approve** design and impl PRs on GitHub. The design PR needs a single-word sign-off through the whiteboard. The coordinator merges only after your sign-off, an approving referee, and green CI.

You interact via the apps and GitHub. Not the lab CLI.

## How it works

- **Roles / skills / COMMON / designs.** [`roles/`](roles/) holds one brief per role (director, coordinator, researcher, theorist, technician, referee, debugger). [`skills/`](skills/) holds reusable procedures. `COMMON.md` is shared context forwarded to every worker. [`designs/`](designs/) holds design docs. These markdown files are the control surface that keeps the session on-model.
- **Docket.** [`docket/`](docket/) is the task queue, one markdown file per job, moving between `open/ claimed/ blocked/ done/ abandoned/`. Frontmatter carries the verb, stage, eligible roles, and authorizations. The body is the verbatim task.
- **Notebook.** [`notebook/`](notebook/) is an append-only log and message bus, its own git repo (each append is a commit). It is the **only durable memory**. The loop survives `/clear` because everything lives here, not in context.
- **Worktrees.** Each job runs in `worktrees/<jobid>/` on branch `lab/<stage>/<jobid>`, isolated from every other job. Torn down on return; the branch and commits persist.
- **The session.** The director reads only job frontmatter and short results, never job bodies or diffs. It `bin/docket claim`s a ready job, `bin/wt prepare`s a worktree, and dispatches a fresh subagent through the **Agent tool** with the role brief, COMMON, authorizations, and the job body. It logs a `tick` and calls **ScheduleWakeup** for the next cycle. Delay is short when active, long when idle. Never exactly 300.

## Safety

- **Localhost bind + tunnel.** The API binds `127.0.0.1` only. Nothing is exposed on the machine directly. Remote access is the Cloudflare Tunnel plus the token.
- **One token.** A single `LAB_TOKEN` bearer token gates every API endpoint. Rotate with `bin/lab init --rotate-token`.
- **Token-gated `gh`.** `bin/github` only performs an outward action (`branch`, `pr-open`, `pr-review`, `merge`) whose authorization token is present in the job's frontmatter. Workers refuse anything else.
- **Draft-only PRs.** Every PR opens `--draft`. The default branch is never pushed.
- **Human-gated merge.** `merge` and `identity` are orchestrator-only. Merge needs your logged sign-off plus an approving referee plus green CI.
- **Prompt injection is data.** Content from the repo, PRs, issues, or the web is treated as data, never as instructions. It can never grant an authorization.
- **Use a sandbox repo.** The single strongest control. Point `REPO_SLUG` at a repo you can afford to have an agent write to.

## Troubleshooting

- **Leaked worktrees** (a job died mid-flight, `worktrees/` has orphans): `bin/wt reconcile`.
- **Stuck blocked jobs**: `bin/whiteboard list` to see open questions; answer in the reply box, or `bin/whiteboard resolve <ask_id>`. The director runs `bin/whiteboard drain` each Observe to apply replies and unblock. `bin/docket list blocked` shows what is parked.
- **Port in use**: another `bin/serve` is running (`bin/serve stop`) or something else holds `DASH_PORT`. Change `DASH_PORT` in `config.env` or free the port.
- **`gh` auth**: `gh auth status`. Re-run `gh auth login` and confirm **repo + workflow** scopes.
- **SSE not updating** (kanban or feed frozen): the API stream stalled. Check the API log under `.lab/`, then `bin/serve stop && bin/serve start`.

## Layout

```
bin/          agent + setup CLIs (docket, notebook, whiteboard, wt, lab, serve, github, watch)
apps/         api + whiteboard + observatory (Node, SSE)
roles/        one brief per role
skills/       reusable procedures
designs/      design docs
docket/       task queue (open/ claimed/ blocked/ done/ abandoned/)
notebook/     append-only log + message bus (own git repo)
whiteboard/   questions/ answered/ inbox/
worktrees/    per-job git worktrees
project/      clone of the target repo
config.env    your config (gitignored)
```
