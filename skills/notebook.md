# skill: notebook

## Purpose
The append-only log and message bus. It is the ONLY durable memory. Every assignment, tick, worker result, message, and worktree event lands here. It survives `/clear`; the running context does not.

## When to use
- The director logs one `tick` per OODA cycle and reads `tail` each Observe.
- Every worker ends with a `result` entry and a `message` lesson to director (see [lesson](lesson.md)).
- Any cross-role hand-off (answer relay, follow-on note) is a `message`.
If it is not in the notebook, it did not happen.

## Command(s)
```
bin/notebook append --kind K --role R [--to T] [--job J] [--stage S] [--status ST] \
                    [--refs "a,b"] [--slug S] (--body "text" | --body-file F)   -> prints relpath
bin/notebook tail [N]
bin/notebook read <path>
```
kinds: `assign` | `tick` | `message` | `result` | `worktree`.

## Procedure
1. Observe: `bin/notebook tail 20`. Read the recent tail; do not re-read the whole log.
2. To record work done: `bin/notebook append --kind result --role <role> --job <id> --stage <stage> --status ok --body "<what changed, artifacts, PR link>"`. Use `--status error` only on genuine failure (this is one of the two things that interrupt the human).
3. To send to a role: `--kind message --to director --body "..."`. The director is the default recipient for lessons.
4. Director cycle log: `bin/notebook append --kind tick --role director --body "<observed / oriented / acted>"`.
5. To inspect one entry: `bin/notebook read notebook/YYYY/MM/DD/<file>.md`.

## Output
- `append` prints the relative path `notebook/YYYY/MM/DD/<HHMMSS>Z-<kind>-<slug>.md`. Pass that path to `bin/docket complete <id> --result <path>`.
- Each append is its own git commit in the notebook repo.

## Notes / pitfalls
- Append-only. Never edit or delete entries. A correction is a new entry.
- Routine work writes ONLY the notebook. It is silent by design. The human is interrupted only by a whiteboard question or a `result` with `status:error`.
- Keep bodies short: what changed, where, and the artifact ref. The director reads short results, never diffs or job bodies.
- Frontmatter carries `ts, kind, role, to?, job?, stage?, status?, refs[]`. Set `--job` and `--stage` so the entry is attributable in the observatory feed.
- Lessons are never silent edits to roles/skills. They are `message` entries to director. See [lesson](lesson.md).
