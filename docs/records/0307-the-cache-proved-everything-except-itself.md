# The cache proved everything except itself

`nts check` and `emit-c`, in the same tree, from the same source, in the same
second:

```
emit-c   wrote program.c, nts_runtime.c to /tmp/…      (no refusals)
check    refused: NTS1001 a generator whose element type is not recorded
         refused: NTS1001 a generator whose element was not reserved
```

The change under test was one line in `compiler/frontend-ts/src/tsgo/decompose.rs`
adding `AsyncGenerator` to the list of types the compiler represents natively,
which is what makes the checker's type arguments get recorded. `emit-c` saw it.
`check` did not, because `check` goes through `nts_frontend_ts::cache`, and
**8581 stored snapshots went on answering without it.**

## What the cache checks, which is nearly everything

Its own header says a wrong hit "would cost a green gate", and it is careful:

- every source file it read still hashes the same
- the tsconfig and everything it `extends`
- the `.ts` listing under the project, so an addition is not invisible
- the `tsgo` binary's identity
- the snapshot schema version

Five freshness proofs, and the one thing none of them covers is **the code that
turns tsgo's answers into a snapshot**. `tool` stamps the tool that answered the
questions. The decomposer that asks them, decides which types to walk into and
which to keep as library types, and writes the `type_arguments` map is the
compiler itself, and nothing recorded it.

The `configs` field is the proof this was a blind spot rather than a trade-off.
It exists with a comment saying that without it "every cache on every machine
would keep answering from entries that never checked a configuration -- which is
the bug, surviving its own fix." The same sentence was true of the compiler and
nobody wrote it.

## Why `schema` is not the fix

It is the obvious lever and it is the wrong one twice over. The snapshot's
*shape* was unchanged — v12 before and after — so bumping it would be a lie
about what changed. And a version number bumped by hand is a step that gets
forgotten exactly when it matters: by someone making a one-line change to a
list, which is what this was.

The fix stamps the running executable's length and modification time. That is
automatic, and the granularity is right rather than merely safe:

|  | entries kept |
|---|---|
| gate whose `build` step relinked nothing | all of them |
| gate that rebuilt the compiler | none — and that is the run whose answers were going to be wrong |

Not the binary's contents: it is ~100MB and this is on the path of every
compile, where the metadata read is two syscalls and changes on exactly the
event that matters.

## The shape

A cache is a claim that two computations are equal. This one enumerated the
*inputs* to the computation and forgot the computation. That is the same error
as [0305](0305-the-comment-stated-the-general-rule-and-the-code-did-not.md) and
[0306](0306-tightening-a-rule-drops-what-it-covered-by-accident.md) in a third
costume: a rule stated over a domain nobody enumerated.

**What made it survivable:** `NTS_NO_SNAPSHOT_CACHE=1` exists, with a comment
saying it is "what to reach for when a stale entry is ever suspected: the answer
should not change." The escape hatch was there and correct. But it is only
reachable by someone who already suspects the cache, and what the symptom looked
like was a compiler bug — two refusals with plausible messages, naming a real
construct, from a run that had just been given new code. I read the refusals as
a regression in my own change first.

**How to apply:** when two commands disagree about one tree, ask which of them
is memoised before debugging either. And when adding a freshness check to a
cache, the list to enumerate is not "what did this read" but "what could change
the answer" — the reader is on that list.
