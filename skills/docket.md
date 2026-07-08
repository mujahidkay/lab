# skill: docket

## Purpose
Post, claim, and retire units of work on the lab's task queue. States are directories; a claim is an atomic rename, so at most one worker owns a job.

## When to use
- The director posts follow-on jobs and claims the highest-priority ready job each Act step.
- A worker posts a follow-on job (for example a fix job after a revise verdict).
- The coordinator retires a job on merge, or abandons a dead one.
Read job frontmatter, never job bodies. Bodies go to the subagent via [assign](assign.md).

## Command(s)
```
bin/docket post --verb V --title "T" [--target owner/repo] [--priority 1..3] [--stage S] \
                [--eligible "r1,r2"] [--authorizations "t1,t2"] [--refs "..."] \
                [--preconditions "..."] (--body "text" | --body-file F)   -> prints job id
bin/docket claim <id> [--role R]        -> prints claimed path; exits 1 printing "lost-race" if beaten
bin/docket complete <id> [--result <notebook-path>]
bin/docket abandon <id> [--reason "..."]
bin/docket block <id> --ask <ask_id>
bin/docket unblock <id> [--answer "text"]
bin/docket list [open|claimed|blocked|done|abandoned ...]
bin/docket path <id>
```
verb is one of: research | design | build | review | fix | merge | improve.
stage (kanban): queued research design build review fix merge blocked done.
authorizations: push | open-pr | review-comment | merge.

## Procedure
1. Observe: `bin/docket list open claimed blocked`. Read only frontmatter (id, verb, priority, stage, preconditions, authorizations).
2. Pick the highest-priority ready open job whose preconditions are met.
3. Claim it: `bin/docket claim <id> --role <role>`. If it prints `lost-race` and exits 1, another claimer won. Do not retry that id.
4. Hand off: `bin/wt prepare <id> --stage <stage>` (see [worktree](worktree.md)), then dispatch via [assign](assign.md).
5. On subagent return, read the short result only. Then `bin/docket complete <id> --result <notebook-path>` (or `abandon <id> --reason "..."`).
6. Tear the worktree down: `bin/wt teardown <id>`.
7. To post a follow-on: `bin/docket post --verb <v> --title "..." --stage <s> --eligible "<roles>" --authorizations "<tokens>" --refs "<prior job/PR>" --body "..."`.

## Output
- `post` prints the new job id (used everywhere else).
- `claim` prints the claimed path, or `lost-race` on stderr with exit 1.
- `list` prints one line per job with state and frontmatter.

## Notes / pitfalls
- Claim is the ONLY safe way to take a job. Never move files by hand.
- `claim` also snapshots the job's verbatim body into the [notebook](notebook.md) as a `kind: assign` entry (slug `claim-<id>`), so the full task text is journaled in versioned history even after `docket/done` is cleaned. This is automatic; you never journal the body yourself.
- A `lost-race` is normal under concurrency, not an error to log loudly. Move on.
- Only tokens in `authorizations` reach the worker. Omit `merge` from worker jobs; it is orchestrator-only and human-gated.
- `block`/`unblock` are driven by the whiteboard, not called by hand. `whiteboard ask` blocks the job for you; `whiteboard drain` unblocks it. See [whiteboard](whiteboard.md).
- Respect `preconditions` (for example: design PR approved before build). A job whose preconditions are unmet is not ready.
