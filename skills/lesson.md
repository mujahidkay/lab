# skill: lesson

## Purpose
Close every engagement with a one-paragraph lesson so the lab improves without silent drift. A lesson is a `message` to director. Roles and skills are NEVER edited silently by a worker.

## When to use
Every worker, at the very end of every job, after the `result` entry. No exceptions: even a clean, uneventful job ends with a lesson (which may simply be "nothing surprised me here").

## Command(s)
```
bin/notebook append --kind message --role <role> --to director --job <id> \
                    --slug lesson --body "<one paragraph>"   -> prints relpath
```
On the director side, a lesson that implies a change becomes an `improve` job or a whiteboard question:
```
bin/docket post --verb improve --title "..." --refs "<lesson path>" --body "..."
bin/whiteboard ask --concern "..." --job <id> --raised-by director --recommended "..." --body "..."
```

## Procedure
1. Finish the substance: commit work, write the `result` entry.
2. Reflect in one paragraph: what was ambiguous, what convention bit you, what the brief got wrong, what the next worker should know. Concrete and short.
3. Append it: `bin/notebook append --kind message --role <role> --to director --job <id> --slug lesson --body "..."`.
4. Return. The director reads it next Observe.
5. Director triage: if the lesson implies a change to a role, skill, or design, the director posts a human-reviewed `improve` job OR raises a whiteboard question. The director does not silent-edit either.

## Output
A `message` notebook entry addressed `to: director`. That is the lesson's whole footprint.

## Notes / pitfalls
- NEVER silent-edit `roles/*.md` or `skills/*.md` as a "lesson." A lesson is a message; a change is a human-reviewed `improve` job. This is the guardrail against the fleet quietly rewriting its own rules.
- One paragraph. Not a report, not a diff. If it needs a diff, that is an `improve` job.
- Address it `to director`. The director is the only aggregator of lessons.
- A lesson is not an apology or a status line; it is a durable note for the next worker or for the director's improvement loop. Write it for the reader, not for yourself.
- Uneventful is a valid lesson ("brief was accurate; no surprises"). It confirms the current docs are load-bearing and correct.
