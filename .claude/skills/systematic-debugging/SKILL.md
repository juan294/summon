---
name: "Systematic Debugging"
description: "A disciplined procedure for finding root causes -- reproduce, isolate, hypothesize, bisect, fix, verify. Consult when a bug is non-obvious, a fix didn't hold, or you've tried the same thing twice without progress."
user-invocable: false
---

# Systematic Debugging

When stuck, stop guessing. Run the loop. Random edits that "might fix it"
waste turns and mask the real cause. For known tool/git/CI failures, check the
Error Patterns skill first — this skill is for novel bugs.

## The Loop

1. **Reproduce.** Get a reliable, minimal repro before changing anything. A bug
   you cannot reproduce on demand, you cannot confirm fixed. Note the exact
   command, inputs, and expected-vs-actual.
2. **Isolate.** Shrink the surface. Remove inputs, comment out code, halve the
   data until the smallest thing that still fails remains. `git bisect` when a
   regression has a known-good past commit.
3. **Hypothesize.** State ONE specific, falsifiable cause: "X is null because Y
   runs before Z." If you cannot name a mechanism, you are still guessing.
4. **Test the hypothesis.** Add a log/breakpoint/assertion that the hypothesis
   predicts. Observe. Confirm or kill it before touching the fix.
5. **Fix the root cause.** Not the symptom. If the fix is "add a null check,"
   ask why it is null — that is usually the real bug.
6. **Verify.** Re-run the repro from step 1. Then run the surrounding tests to
   confirm you broke nothing. A fix unconfirmed against the original repro is
   not a fix.

## Discipline

- **Read the actual error.** Full message, full stack trace, top to bottom. The
  answer is in there more often than not. Don't skim to the first familiar line.
- **One change at a time.** Change-everything-and-pray destroys the signal about
  what actually mattered. Revert failed experiments before the next one.
- **Trust nothing, verify everything.** Don't assume which function runs, what a
  variable holds, or that a dependency is installed. Add the log and look.
- **Bisect over speculation.** When a thing used to work, the diff that broke it
  is findable mechanically. Don't theorize about a regression you can bisect.
- **Question the assumption, not just the code.** If reality contradicts your
  mental model, the model is wrong. Find which assumption is false.

## Stop conditions

- Same approach twice with no new information -> stop, change technique, or
  escalate. Repeating a failed action is Error #-class behavior.
- Fix doesn't hold after verify -> the hypothesis was wrong. Return to step 3
  with what you just learned. Do not pile a second guess on top.
- Root cause genuinely unclear after the loop -> surface what you ruled out and
  what remains, and ask. A documented dead end beats a silent wrong fix.
