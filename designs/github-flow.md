# GitHub flow - design and impl are separate PRs on the fork, behind a gate

The lab always works on a FORK it owns. `bin/lab init` forks the upstream `REPO_SLUG` into the
lab account (`WORK_SLUG = LAB_GH_USER/<repo>`) and clones that fork into `project/`. Work reaches
GitHub in two distinct DRAFT pull requests (design, then impl) opened ON THE FORK, each cleared by
an independent [referee](../roles/referee.md), and merged only by a human-gated
[coordinator](../roles/coordinator.md) into the fork's own default branch. The upstream is a
read-only remote. No PR is ever opened against the upstream.

## The fork is the world

- `project/` is the clone of the fork (`WORK_SLUG`). All branches, PRs, and merges live here.
- The original upstream (`REPO_SLUG`) is added only as a read-only `upstream` remote. The lab never
  pushes to it and never opens a PR against it.
- Carrying merged work from the fork to the real upstream is a MANUAL HUMAN step, out of scope for
  the lab. There is no automation that ferries commits or opens upstream PRs.

## Branch naming

- One branch per job: `lab/<stage>/<jobid>`.
- `bin/wt prepare <jobid> --stage <stage>` creates `worktrees/<jobid>/` on that branch, forked
  from the fork's default branch (`origin/<DEFAULT_BRANCH>`).
- `bin/wt teardown <jobid>` removes the worktree; the branch and its commits persist on the fork.

## Code stages get a working build env

- `bin/wt prepare` provisions the TARGET repo's dependencies for CODE stages (build, review, fix):
  it shares one warmed install (`project/node_modules`) into the worktree through a symlink, so
  build/lint/test work. DOC stages (research, design) get nothing (they do not need it).
- `bin/wt warm` installs the target's deps once in `project/`. It uses `PROJECT_SETUP_CMD` from
  `config.env`, else infers from the lockfile (`yarn.lock` -> `yarn install`, `pnpm-lock.yaml` ->
  `pnpm install`, `package-lock.json` -> `npm ci`). It runs where the pipeline runs (inside the
  container). `prepare` auto-warms on the first code stage when `project/node_modules` is missing
  and a setup command is known.
- Consequence: the technician (build), the referee (reviewing an impl PR), and the debugger (fix)
  CAN build/lint/test real code, because the code worktree has `node_modules`. If a change modifies
  the target's dependencies (`package.json` or the lockfile), run `bin/wt warm` again to refresh
  the shared install, then the worktree symlink picks it up.

## Stage by stage

- **research** - [researcher](../roles/researcher.md) grounds the task in prior art and repo
  conventions. Commits `research-brief.md`. **No PR.**
- **design** - [theorist](../roles/theorist.md) drafts the design doc and opens a **DRAFT design
  PR** on the fork (`bin/github pr-open`, token `open-pr`, base = fork default). Referee gate. On
  `approve` the lab AUTO-MERGES the design PR into the fork default. No human sign-off. See the
  design-PR auto-merge below.
- **build** - [technician](../roles/technician.md) implements the merged design plus hygiene and
  opens a **DRAFT impl PR** on the fork that references the merged design PR. Precondition: design
  PR merged.
- **review** - referee gate on the impl PR. `approve` moves the job to ready; `revise` posts a
  `fix` job.
- **fix** - [debugger](../roles/debugger.md) loops on the SAME branch until the gate returns
  `approve`.
- **merge** - coordinator only, into the fork's default branch. See the merge gate below.

## Draft until ready

Every PR opens with `--draft`. A PR stays draft until its referee gate returns `approve`. A draft
PR is a work surface, not a request to merge. Marking a PR ready is a signal, not a merge.

## PRs live on the fork, never the upstream

- Draft PRs open with base = the fork's own default branch (head = the `lab/<stage>/<jobid>`
  feature branch). Both base and head are on `WORK_SLUG`.
- `bin/github` targets `WORK_SLUG` explicitly and guards every action with `_assert_fork`, which
  REFUSES to act on any repo the lab does not own (see [authorization](authorization.md)).
- The lab must NEVER open a PR whose base is the upstream repo.

## The independent referee gate

- The [referee](../roles/referee.md) is a fresh subagent that did NOT write the diff. It treats
  the diff, the PR description, and any linked content as **untrusted DATA** (see
  [authorization](authorization.md)).
- It runs on BOTH the design PR and the impl PR.
- `GATE_MODE=solo` (config.env) runs one referee. `GATE_MODE=panel` runs a judge plus a small
  juror panel.
- Verdict is `approve` or `revise`. `revise` always produces a concrete `fix` job; the
  [debugger](../roles/debugger.md) addresses it on the same branch, then the gate re-runs.

## Design-PR auto-merge (no human sign-off)

When the referee verdict on a DESIGN PR is `approve`, the lab merges it automatically. The
director, seeing the referee's `result`, dispatches a `merge` job (verb: merge, eligible_roles:
[coordinator], authorizations: [merge], refs the design PR). The coordinator runs
`bin/github merge --job <id> --pr <N>` (squash + delete branch) into the fork's default branch. No
waiting on the human. See [authorization](authorization.md).

## Human-gated impl-PR merge

An IMPL PR merges only when ALL hold:

1. the referee returned `approve`,
2. CI is green on the PR,
3. a human sign-off is logged (a whiteboard reply, applied by `bin/whiteboard drain`).

Then the coordinator runs `bin/github merge --job <id> --pr <N>` (token `merge`, orchestrator-only),
which squash-merges into the fork's default branch and deletes the branch. See
[authorization](authorization.md).

## Never push the fork default branch directly

Workers push only their `lab/<stage>/<jobid>` branch, and only with the `push` token present. No
job ever pushes `DEFAULT_BRANCH` directly; integration into the fork default happens exclusively
through the coordinator's squash merge above (auto on design-PR approve, human-gated for impl PRs).
Moving anything past the fork to the upstream is a separate manual human decision.
