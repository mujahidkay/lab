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
bin/wt teardown <jobid>                           # removes the worktree; the branch + commits persist
bin/wt reconcile                                  # prune leaked worktrees + stale markers
```

## Procedure
1. Prepare: `bin/wt prepare <jobid> --stage <stage>`. It fetches origin, creates `worktrees/<jobid>` on a fresh branch `lab/<stage>/<jobid>`, and prints the absolute path. Use that path as the `[WORKING DIR]` in the dispatch prompt.
2. Optionally pin a base: `--base <REF>` (for example the approved design branch for a build job). Default base is the project's default branch tip.
3. Dispatch the worker into that path (see [assign](assign.md)).
4. On return: `bin/wt teardown <jobid>`. The commits on `lab/<stage>/<jobid>` remain for the PR.
5. At boot, and after any crash: `bin/wt reconcile` to prune worktree dirs with no live (claimed/blocked) job.

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
