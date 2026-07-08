# OODA loop - the director's heartbeat

One ScheduleWakeup fire = one cycle. The [director](../roles/director.md) runs these five steps,
then schedules the next fire and stops until then. A cycle that dispatches nothing is still a
valid cycle, not a reason to stop.

## The five steps

1. **Observe.** Read current state, cheaply.
   - `bin/notebook tail 20`
   - `bin/docket list open claimed blocked`
   - `bin/whiteboard list`
   - `bin/whiteboard drain` (applies inbox replies: unblocks jobs, resolves questions, logs a
     `message`).
2. **Orient.** Compute the `active` flag (below).
3. **Act.** At most ONE substance unit. Claim the highest-priority ready `open` job whose
   preconditions are met (`bin/docket claim <id>`), `bin/wt prepare <id>`, then
   [assign](../skills/assign.md) it via the Agent tool. If nothing is ready, act zero times.
   - On a subagent return: read the short `result` only, then `bin/docket complete <id>` (or
     `abandon`), then `bin/wt teardown <id>`.
4. **Log.** `bin/notebook append --kind tick` summarizing what this cycle observed and did.
5. **Schedule-next.** Compute the delay (below) and call
   `ScheduleWakeup(delaySeconds=delay, prompt="<<autonomous-loop-dynamic>>", reason="...")`.

## active vs idle

`active` is true if ANY of these hold:

- an in-flight assignment (a claimed job with a subagent out),
- propagating CI on an open PR,
- a human touch in the last cycle,
- a re-review pending (a `fix` job awaiting the referee),
- a non-empty `docket/open/`,
- an unread inbox reply,
- an open whiteboard question.

Otherwise `idle`.

## Pacing

```
delay = active ? clamp(ACTIVE_MIN=60,  ACTIVE_MAX=1800)
              : clamp(IDLE_MIN=1800, IDLE_MAX=3600)
```

- **NEVER schedule exactly 300 seconds.** (It is the reserved default; picking it means the loop
  was not thought through.) If a computation lands on 300, nudge it.
- Config lives in `config.env` (ACTIVE_MIN/MAX, IDLE_MIN/MAX).

## Two hard rules

- **Never self-terminate.** A zero-dispatch cycle schedules the next fire and returns. The loop
  ends only when the human stops the session.
- **Never sit for a full cycle when work is live.** If `active`, use the short band so in-flight
  work is checked promptly.

## Quiet-cycle consolidation

When a cycle is fully idle (nothing to Observe, nothing to Act on), use it for hygiene, not
noise:

- `bin/wt reconcile` to prune any leaked worktrees.
- Confirm `bin/watch` is still running (background Bash, surfaced via Monitor); restart if not.
- One consolidating `tick` is enough. Do not spam the notebook on quiet cycles.

The watcher (`bin/watch`) appends a single `message` on terminal or actionable
transitions (inbox reply arrived, CI passed or failed, new open job). Treat that message as the
trigger to shorten the next delay.
