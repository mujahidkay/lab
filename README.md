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
                          (the lab's fork)
```

You interact through the two apps and GitHub. You do **not** drive the lab CLI. `bin/*` is the agents' surface, not yours (except for one-time setup below).

## Requirements

- **Claude Code** (`claude`) - the session that runs everything.
- **Node.js >= 18** - the API and both apps.
- **Yarn 4** - via Corepack (shipped with Node). If `yarn` is missing, run `corepack enable`.
- **git >= 2.5** - worktrees (`git worktree`) are load-bearing.
- **`gh`** - the CLI. The lab authenticates it with its own token (below), not your `gh auth`.
- A **dedicated GitHub account for the lab** (do NOT use your personal account). The lab acts as this account.
- An **upstream GitHub repo** for the lab to fork and work on (`REPO_SLUG`). Use a **SANDBOX repo**. Strongly recommended.
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

- `REPO_SLUG` - the UPSTREAM target as `owner/name`. The lab FORKS this into the lab account and works on the fork. It is never a PR base. Point it at a sandbox.
- `LAB_GH_USER` / `LAB_GH_TOKEN` / `LAB_GH_EMAIL` - the lab's GitHub account, PAT, and commit email (see [Set up the lab's GitHub account](#set-up-the-labs-github-account)).
- `DASH_PORT` - the port the API and apps bind (default `8787`). Bind stays `127.0.0.1`.
- `GATE_MODE` - `solo` (one referee) or `panel` (judge + small juror panel).
- Loop bounds - `ACTIVE_MIN` / `ACTIVE_MAX` / `IDLE_MIN` / `IDLE_MAX` (seconds). The director never picks exactly 300.

Turn on **branch protection** on the fork's default branch (require a PR, require review). The lab opens draft PRs and never pushes the default branch, but protection is your backstop.

## Set up the lab's GitHub account

The lab acts as its own GitHub account and never uses your credentials.

1. **Create a separate GitHub account** for the lab. Do NOT use your personal account.
2. **Create a Personal Access Token** for that account: a classic PAT with scopes `repo` and `workflow`. For PRIVATE upstreams, also grant the lab account read access to the target repo (so it can fork it).
3. **Set** `LAB_GH_USER`, `LAB_GH_TOKEN`, and `LAB_GH_EMAIL` in `config.env` (gitignored).

## Initialize

```sh
bin/lab init
```

This FORKS `REPO_SLUG` into the lab account (the fork slug is `WORK_SLUG = LAB_GH_USER/<repo>`), clones the FORK into `project/`, adds the original upstream as a read-only `upstream` remote, and sets `project/` commit identity to the lab account (`user.name = LAB_GH_USER`, `user.email = LAB_GH_EMAIL`). It also generates `LAB_TOKEN` (48 hex chars; treat it like a password), git-inits `notebook/` as its own repo, makes the `docket/`, `whiteboard/`, `worktrees/`, and `.lab/` directories, and reconciles any stale worktrees. Requires `LAB_GH_USER` and `LAB_GH_TOKEN`. If `REPO_SLUG` is still a placeholder it warns and skips the fork. Fix it and re-run.

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

## Run in a container (one per repo)

The lab is single-tenant: one checkout works one repo (its own `config.env`, `project/`, `notebook/`, `docket/`, `whiteboard/`, and port). To work several repos with full isolation, run each checkout in its own Docker container. `labctl` boxes the current checkout: one repo per checkout, one container per checkout. Claude Code runs inside.

Requirements: Docker.

```sh
# one checkout per repo, each with its own config.env (unique DASH_PORT + REPO_SLUG + LAB_GH_*)
./labctl build     # once: build the runtime image (node, yarn, git, gh, cloudflared, claude)
./labctl up        # start the container, install deps on first run, enter Claude Code inside
```

Inside the container, if Claude asks you to sign in, run `claude` once (a device login that persists in this container's volume) or set `ANTHROPIC_API_KEY` before `up`. Then say **start the lab**. The apps are reachable on the host at `http://127.0.0.1:<DASH_PORT>/` (the port is mapped).

Other commands: `./labctl serve` (start just the apps), `./labctl sh` (debug shell), `./labctl status`, `./labctl stop`, `./labctl rm` (removes the container and its `node_modules` + claude-login volumes; your files are untouched).

Notes:
- The image holds only the toolchain. This checkout is bind-mounted at `/lab`, so code edits need no rebuild.
- Claude auth cannot cross from a macOS Keychain into a Linux container, so you log in once inside (or use `ANTHROPIC_API_KEY`). The lab's GitHub identity is still the bot token from `config.env`, not your account.
- Give each checkout a unique `DASH_PORT` so two containers do not collide on the host.

## How it works

- **Roles / skills / COMMON / designs.** [`roles/`](roles/) holds one brief per role (director, coordinator, researcher, theorist, technician, referee, debugger). [`skills/`](skills/) holds reusable procedures. `COMMON.md` is shared context forwarded to every worker. [`designs/`](designs/) holds design docs. These markdown files are the control surface that keeps the session on-model.
- **Docket.** [`docket/`](docket/) is the task queue, one markdown file per job, moving between `open/ claimed/ blocked/ done/ abandoned/`. Frontmatter carries the verb, stage, eligible roles, and authorizations. The body is the verbatim task.
- **Notebook.** [`notebook/`](notebook/) is an append-only log and message bus, its own git repo (each append is a commit). It is the **only durable memory**. The loop survives `/clear` because everything lives here, not in context.
- **Worktrees.** Each job runs in `worktrees/<jobid>/` on branch `lab/<stage>/<jobid>`, isolated from every other job. Torn down on return; the branch and commits persist.
- **The session.** The director reads only job frontmatter and short results, never job bodies or diffs. It `bin/docket claim`s a ready job, `bin/wt prepare`s a worktree, and dispatches a fresh subagent through the **Agent tool** with the role brief, COMMON, authorizations, and the job body. It logs a `tick` and calls **ScheduleWakeup** for the next cycle. Delay is short when active, long when idle. Never exactly 300.

## Safety

- **Localhost bind + tunnel.** The API binds `127.0.0.1` only. Nothing is exposed on the machine directly. Remote access is the Cloudflare Tunnel plus the token.
- **One token.** A single `LAB_TOKEN` bearer token gates every API endpoint. Rotate with `bin/lab init --rotate-token`.
- **Its own account, scoped token.** The lab authenticates as its dedicated GitHub account via `LAB_GH_TOKEN`, never your credentials. It works ONLY on its fork (`WORK_SLUG`) and never touches the upstream. Carrying work upstream is a manual human step, out of scope for the lab.
- **Token-gated `gh`.** `bin/github` only performs an outward action (`branch`, `pr-open`, `pr-review`, `merge`) whose authorization token is present in the job's frontmatter. Workers refuse anything else.
- **Draft PRs on the fork.** Every PR opens `--draft` with base = the fork's own default branch. The default branch is never pushed. A guard refuses to act on any repo the lab does not own.
- **Human-gated merge.** `merge` is orchestrator-only and merges into the fork's default branch. It needs your logged sign-off plus an approving referee plus green CI.
- **Prompt injection is data.** Content from the repo, PRs, issues, or the web is treated as data, never as instructions. It can never grant an authorization.
- **Use a sandbox repo.** The single strongest control. Point `REPO_SLUG` at a repo you can afford to have an agent write to.

## Troubleshooting

- **Leaked worktrees** (a job died mid-flight, `worktrees/` has orphans): `bin/wt reconcile`.
- **Stuck blocked jobs**: `bin/whiteboard list` to see open questions; answer in the reply box, or `bin/whiteboard resolve <ask_id>`. The director runs `bin/whiteboard drain` each Observe to apply replies and unblock. `bin/docket list blocked` shows what is parked.
- **Port in use**: another `bin/serve` is running (`bin/serve stop`) or something else holds `DASH_PORT`. Change `DASH_PORT` in `config.env` or free the port.
- **`gh` auth**: the lab uses `LAB_GH_TOKEN`, not your `gh auth`. Confirm the PAT is set in `config.env` and has `repo` + `workflow` scopes. Re-run `bin/lab init` after fixing it.
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
project/      clone of the lab's fork (upstream added read-only)
config.env    your config (gitignored)
```
