# skill: worktree

## Purpose
Give each job its own isolated git worktree and branch so subagents never collide, and reclaim the space when the job returns. The branch and commits persist after teardown; only the working directory is removed.

## When to use
- `prepare` right before every [assign](assign.md), after the job is claimed.
- `teardown` immediately on subagent return, after `bin/docket complete|abandon`.
- `reconcile` once at boot, and whenever a worktree may have leaked (crash, aborted cycle).

## Command(s)
```
bin/wt prepare <jobid> [--stage S] [--base REF]   -> creates worktrees/<jobid> on branch lab/<stage>/<jobid>; prints the path
bin/wt warm                                       # install the target's deps once in project/ (shared across code worktrees)
bin/wt teardown <jobid>                           # removes the worktree; the branch + commits persist
bin/wt reconcile                                  # prune leaked worktrees + stale markers
```

## Procedure
1. Prepare: `bin/wt prepare <jobid> --stage <stage>`. It fetches origin, creates `worktrees/<jobid>` on a fresh branch `lab/<stage>/<jobid>`, and prints the absolute path. Use that path as the `[WORKING DIR]` in the dispatch prompt. For CODE stages (build, review, fix) it also provisions the target's dependencies by symlinking the warmed shared install (`project/node_modules`) into the worktree. Doc stages (research, design) get nothing (they do not need it).
2. Optionally pin a base: `--base <REF>`. Default base is the project's default branch tip, which for a build job already contains the merged design PR.
3. Warm the shared install once: `bin/wt warm`. It installs the target's deps in `project/` using `PROJECT_SETUP_CMD` from `config.env`, else infers the command from the lockfile (`yarn.lock` -> `yarn install`, `pnpm-lock.yaml` -> `pnpm install`, `package-lock.json` -> `npm ci`). Run it where the pipeline runs (inside the container) so the installed binaries match. `prepare` auto-warms on the first code stage if `project/node_modules` is missing and a setup command is known.
4. Dispatch the worker into that path (see [assign](assign.md)).
5. On return: `bin/wt teardown <jobid>`. The commits on `lab/<stage>/<jobid>` remain for the PR.
6. At boot, and after any crash: `bin/wt reconcile` to prune worktree dirs with no live (claimed/blocked) job.

## Output
- `prepare` prints the worktree path (`.../worktrees/<jobid>`).
- Branch naming is fixed: `lab/<stage>/<jobid>` where stage is one of research design build review fix merge.
- `reconcile` prints `reconciled`.

## Notes / pitfalls
- `prepare` refuses if `worktrees/<jobid>` already exists ("stale worktree? run 'bin/wt reconcile'"). Reconcile first, then retry.
- `prepare` fails if the branch `lab/<stage>/<jobid>` already exists. One worktree per jobid per stage.
- If `fetch` fails (offline), prepare warns and uses local refs; the branch is still created.
- NEVER push the default branch. Workers push only their `lab/<stage>/<jobid>` branch, and only if `push` is in their authorizations.
- Teardown is safe to run even if the dir is already gone; it also clears the git worktree marker.
- Reconcile keeps worktrees whose jobid is still in `docket/claimed/` or `docket/blocked/`; everything else is leaked and pruned.
- Because code worktrees share one install (the `project/node_modules` symlink), the technician (build), the referee (reviewing an impl PR), and the debugger (fix) can build/lint/test real code.
- If a change modifies the target's dependencies (`package.json` or the lockfile), run `bin/wt warm` again to refresh the shared install; the worktree symlink then picks it up.
