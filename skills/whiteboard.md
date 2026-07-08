# skill: whiteboard

## Purpose
The one channel for genuine ambiguity. A worker raises ONE question and returns; the human answers via the app; the orchestrator drains answers back into the docket. Silent until a decision is needed. Workers NEVER block on stdin.

## When to use
- A worker hits genuine ambiguity that no documented default resolves. Raise ONE question, then return. Do not spin, do not block, do not ask twice.
- The orchestrator runs `drain` every Observe to fold human replies back into blocked jobs.
- The coordinator runs `list` to see open questions when a human is interacting.
If a documented default exists, take it. The whiteboard is for the residue only.

## Command(s)
```
bin/whiteboard ask --concern C --job J --raised-by ROLE --recommended "single-word-signoff hint" \
                   (--body "<=80-word ambiguity" | --body-file F)   -> prints ask_id AND parks the job in docket/blocked/
bin/whiteboard list
bin/whiteboard resolve <ask_id> [--answer "..."]
bin/whiteboard drain     # applies inbox replies -> unblocks jobs, resolves questions, logs a message
```

## Procedure
1. Worker, on genuine ambiguity: `bin/whiteboard ask --concern "<one phrase>" --job <jobid> --raised-by <role> --recommended "<the sign-off word you propose>" --body "<=80 words stating the ambiguity and the choices>"`.
2. `ask` prints an `ask_id` and blocks the job (`docket/blocked/<jobid>.md`, `blocked_on: <ask_id>`). The worker then RETURNS. It does not wait.
3. Human answers via the whiteboard app; the API writes `whiteboard/inbox/<ts>-<ask_id>.json`.
4. Orchestrator, each Observe: `bin/whiteboard drain`. This reads inbox replies, unblocks the job (folding the answer into its body), resolves the question, and logs a `message` from coordinator to director.
5. The unblocked job returns to a claimable state; re-assign it (a fresh worker sees the answer in the job body).
6. `bin/whiteboard list` shows open questions (ask_id, concern, job, recommended).

## Output
- `ask` prints the `ask_id` and creates `whiteboard/questions/<ask_id>.md`.
- `drain` prints `drained N`.
- `resolve` moves the question to answered and prints its path.

## Notes / pitfalls
- ONE question per return. If you have two, pick the blocking one; the rest take documented defaults.
- Body is <=80 words. State the choices and your recommendation so the human can reply with a single word (that is what `--recommended` is for).
- `--recommended` is required. It enables single-word sign-off (for example approving a design PR).
- Never block on stdin. `ask` + return is the only pattern.
- The orchestrator drains; workers never resolve their own questions.
- `ask` also serves as the human-gated approval channel: a design PR is approved by a single-word sign-off replied to its question. Merge waits for that logged sign-off (see roles/coordinator.md and [panel](panel.md)).
