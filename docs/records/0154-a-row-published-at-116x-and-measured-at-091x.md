# 0154 — A row published at 1.16x and measured at 0.91x

*Was 0152 for one commit. `c3c2010` claimed that number at 03:18 and this file
was created at 04:35, so it moves rather than the other way round. `a80a8e4`
and `tooling/bench/counted.sh` name the old number; the tool is corrected here
and the commit message is not, because a commit message is a record of what was
believed when it was written.*

`generic-classes` moved from 1.03x to 1.16x across two publishes today and I
flagged it twice as unexplained rather than call it noise. It is worse than
noise: the two numbers are of the same two programs and they disagree by 27%.

## The check

Its prepared HIR contains no `i64`, no array, no erasure, and its operations are
`add`, `and`, `call`, `const`, `convert`, `eq`, `field.get`, `lt`, `object.new`,
`param`, `xor`. Nothing any change this session made can reach it -- the
narrowing pass was about `i64`, the widening extension excludes any class that
computes a member, and `widen` refuses a class touched by `and` or `xor`
outright. So the emitted bytecode is the same bytecode.

A fixed-count driver over the same two programs -- ours and the published Java
reference, `work` called N times, measured at 20,000 and 40,000 and subtracted,
three repetitions, medians:

| | instructions/call | cycles/call |
| --- | ---: | ---: |
| hand-written Java | 39,211 | 12,985 |
| **ours** | **36,624** | **11,875** |

**We execute 6.6% fewer instructions and take 8.5% fewer cycles.** By this
instrument the row is **0.91x**. The suite publishes it at **1.16x**.

## What that means for the column

The harness warns when a row varies more than 1.1x across its own five runs, and
this row did not trip it in either publish. That check catches a row whose JIT
mode is unstable *within one invocation of the harness*; it cannot see a row
that settles consistently into one mode this hour and another mode next hour,
which is what a 1.03x and a 1.16x of the same bytes look like.

So the sub-1.10x band of the `nts (JVM)/Java` column is not resolvable by the
published number alone, at least on rows of a microsecond or two. Twelve of the
twenty-three rows currently above 1.00x sit in that band. That does not make the
column wrong -- `elementwise` at 7.61x and `optional-chain` at 2.12x were real
and moved when the cause was removed -- but it does mean **a row at 1.02x and a
row at 0.98x are the same reading**, and treating the tally as a score to
maximise would optimise noise.

The instrument that does resolve them is the one used here, and it is not
expensive: a fixed-count driver, two counts, subtracted. It removes startup, it
removes warmup, and instructions per operation are load-independent so it does
not even need the measurement lock. What it costs is a driver per case, which
is the reason it has been used per-investigation rather than per-row.

## What I am not doing about it

Not rewriting the harness. The published table is best-of-five with calibration
because that is what `bench.mjs` does for node and what makes the columns
comparable to each other, and changing it would break every historical number
in these records.

What changes is how the small rows get read: **below about 1.10x, believe a
fixed-count measurement over the published one**, and do not spend a change on a
row whose whole gap is inside that band without measuring it that way first. On
this row it would have been spent on a row we were already winning.

---

## Correction, an hour later: instructions are not the substitute

The rule above says *below about 1.10x, believe a fixed-count measurement over
the published one*. Its first use produced a counterexample to itself.

Reading all fifteen rows published above 1.00x with the instrument, instructions
per operation against the published time ratio:

| row | published | instructions | 
| --- | ---: | ---: |
| `awfy-queens` | 1.25 | **1.32** |
| `optional-chain` | 1.01 | **1.23** |
| `symbol-keys` | 1.04 | **1.18** |
| `upcast` | 1.04 | 1.09 |
| `instanceof` | 1.10 | **1.00** |
| `module-closures` | 1.06 | 1.01 |
| `bytes` | 1.01 | **0.96** |
| `generic-classes` | 1.16 | **0.93** |
| `absences` | 1.22 | 1.20 |
| `number-format` | 1.22 | 1.21 |
| `array-methods` | 1.19 | 1.09 |
| `arrays` | 1.02 | 1.01 |
| `strings` | 1.01 | 1.03 |
| `fib` | 1.03 | 1.05 |
| `in-narrowing` | 1.02 | 1.02 |

**`optional-chain` executes 23% more instructions and takes the same cycles.**
Measured under the lock earlier in the day, that row is 2.12 cycles an iteration
against the reference's 2.06 -- parity -- while doing a fifth more work. That is
an IPC difference and it is real; it is not the harness being unable to resolve
a small row.

So instructions per operation are **load-independent and not the answer**. They
count work; the column reports duration; and where the two diverge the
instruction count is measuring the wrong quantity confidently. `number-format`
is the same shape in the other direction.

The rule that survives is narrower and it costs more:

> Below about 1.10x, believe a fixed-count measurement of **cycles**, taken
> while nothing else holds the measurement lock. Instructions are the cheap
> screen -- they need no lock and they are stable to a percent -- and where they
> agree with cycles they settle the row. Where they disagree, the row has an IPC
> story and neither number alone is the answer.

`counted.sh` prints both for that reason, and prints a warning naming which one
the machine's state has spoiled. This entry is what the warning is for: I read
the cycle column of a run made while another session's gate held the lock, saw
`generic-classes` at 1.51 and `module-closures` at 1.44, and those are numbers
about a busy machine and nothing else.

## And the direction I was not checking

Every row above was published as a loss. Nobody re-reads a win, and a row
published at 0.98x that measures 1.06x is a loss recorded as a win -- the same
asymmetry this repository just found in `typescript.md`, where a `✅` beside a
refused fixture survived for months because everything green stays green.

Eighteen rows are published at or under 1.00x and twelve of them are within five
percent of it. Nine of those twelve have been cited today as evidence that a
change worked. Two -- `awfy-bounce` at 0.95 and `awfy-towers` at 0.98 -- are
load-bearing for the claim that seven of the eight AWFY rows are under.

That re-read is queued and its result belongs in this record whichever way it
falls.

---

## Second correction: the row is worse than published, not better

The green re-read came back, and it took the title of this record with it.

`generic-classes`, three repetitions under the measurement lock, nothing else on
the machine:

| | instructions/call | cycles/call | IPC |
| --- | ---: | ---: | ---: |
| hand-written Java | 39,720 / 39,968 / 39,778 | 8,290 / 8,466 / 8,341 | **4.78** |
| ours | 36,952 / 37,096 / 36,947 | 11,619 / 11,845 / 11,578 | **3.19** |
| ratio | **0.93** | **1.40** | |

Both columns are stable to a percent across three runs. **We do 7% less work and
take 40% longer.** The published 1.16x was not overstating this row; it was
*understating* it.

So the headline above -- *published at 1.16x and measured at 0.91x* -- is a
correct instruction count and a wrong conclusion, and it is wrong for exactly
the reason the first correction gives: instructions count work, the column
reports duration, and I read the one that agreed with the story I had.

I dismissed the cycle numbers when I first saw them, at 1.51 and 1.39, because
another session's gate held the lock. They were right. Measured under the lock
they are 1.40 three times, which is what a number about the program rather than
about the machine looks like.

## And the harness is not wrong either, which is the part worth keeping

Java's cycles here are 8,341 -- **1.46 us at this clock, against the 1.45 us the
suite published.** The reference reproduces exactly. Ours is 11,578 cycles,
**2.03 us, against a published 1.68 us.**

The harness takes the best of five. My instrument takes a median of differences.
Those are different statistics, and on a lane whose distribution is *wide* the
first is systematically kinder. Java's distribution here is tight and ours is
not, so best-of-five flatters us and only us.

That is a sharper statement than "the harness cannot resolve small rows". It
can. What it reports is the **best mode this lane has**, and where our
distribution is wider than the reference's -- which is where a JIT settles two
ways and one is much faster -- the published ratio is the ratio of our best to
their typical.

`generic-classes` is bimodal on our side: 1.68 us at its best and about 2.03 us
typically, against a reference that does not vary. Neither number is false and
the honest one to publish is arguable. What is not arguable is that this record
claimed the row was a win when it is the largest unexplained loss among the
small rows, and that it did so by reading the counter that flattered.

---

## Third reading: it is not memory and it is not prediction

The counters, under the lock, same fixed-count driver, per call of 4,096
iterations:

| | instructions | cycles | branch-misses | stalls |
| --- | ---: | ---: | ---: | ---: |
| hand-written Java | 39,722 | 8,282 | 2 | 0 |
| ours | 36,961 | 11,573 | **0** | 0 |

**Zero branch misses on our side and two on theirs**, and the stall counters
read zero for both — this CPU does not supply `stalled-cycles-backend` or
`-frontend`, so those are an absence of data rather than an absence of stalls,
and they are reported here as such.

What is left is 2.83 cycles an iteration against 2.02, with **no misprediction
and no memory event to attribute it to**. Nine instructions an iteration on our
side and 9.7 on theirs. So it is the critical path: our chain through
`total ^ counted.get() ^ (flagged.get() ? 1 : 0)` is about **0.8 cycles longer
per iteration** than the reference's, and neither counter can say which
operation adds it.

And one hypothesis died before it was written up. I had this as the `Box<number>`
field being an `f64` while the reference's `Box<Integer>` holds an int — a width
mismatch forcing `i2d` on store and `d2i` on read. The prepared HIR says
`field.get %0.0 : i32`. Specialization narrowed the field; the inner loop is
pure `i32` with no conversion in it at all, and the three `convert : f64` in the
function are the entry guard and the return.

Which also settles the reference: `Box<Integer>` is *matched* to what this lane
holds, not narrower than it, so the rule against a narrow field does not bite
here.

0.8 cycles an iteration on a 1.68 us row is half a microsecond, and naming the
operation needs `-XX:+PrintAssembly` rather than another counter. It is the
smallest unexplained thing on the board and it is written down as unexplained.

