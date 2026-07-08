# Asking humans - silent until a decision or error

The human is a scarce, interruptible resource. Default to silence. Interrupt only for a genuine
decision the lab cannot make for itself, or an error the lab cannot recover from. Everything
routine goes to the notebook, unread until someone chooses to look.

## Silent-until-decision

- Routine progress writes ONLY the notebook (`bin/notebook append`). It never pages a human.
- The human is interrupted by exactly two things:
  1. a **whiteboard question** (`bin/whiteboard ask`), or
  2. a `result` with `status:error` (surfaced in the observatory feed).
- Nothing else reaches the human. Not a normal `result`, not a `tick`, not a `message` lesson.

## Default vs question

When a worker hits ambiguity, it chooses ONE of two paths. It never does both, and never a third.

- **Take the documented default.** If the role brief, [COMMON](../COMMON.md), the approved
  design, or repo convention already answers the question, follow it and note the choice in the
  `result`. This is the common case.
- **Raise ONE question.** Only when the ambiguity is genuine (no documented default, and the
  choice materially changes the outcome), raise a single whiteboard question and return.

If in doubt, prefer the default. A wrong-but-reversible default beats a human interruption; the
referee gate and the human merge will catch a bad default before it lands.

## The fixed question shape

Raise a question with `bin/whiteboard ask`, always with all four fields:

```
bin/whiteboard ask \
  --concern "<the one thing that is ambiguous>" \
  --job <jobid> \
  --raised-by <role> \
  --recommended "<single-word-signoff hint>" \
  --body "<=80-word statement of the ambiguity and the options>"
```

- ONE concern per question. If two things are unclear, pick the blocking one.
- `--recommended` gives the human a one-word way to sign off (for example `approve`, `yes`,
  option-A). Make saying yes cheap.
- The body is <=80 words: the ambiguity and the concrete options, nothing else.
- `bin/whiteboard ask` also parks the job in `docket/blocked/`; the worker returns immediately.

## Never block

- Workers NEVER wait on stdin and NEVER poll for an answer. They raise ONE question (or take the
  default) and RETURN.
- The answer arrives asynchronously: the human replies on the whiteboard, the API writes an inbox
  reply, and `bin/whiteboard drain` (run by the director each Observe) applies it, unblocks the
  job, and resolves the question. See [ooda-loop](ooda-loop.md).
- The director itself never talks to the human; the [coordinator](../roles/coordinator.md) posture
  relays questions and answers. The director just keeps cycling while blocked jobs wait.

## What is NOT a question

- A code defect found in review is not a question; it is a `revise` verdict and a `fix` job. See
  [github-flow](github-flow.md).
- A better idea is not a question; it is a closing `message` lesson that may become a
  human-reviewed `improve` job. See [authorization](authorization.md).
