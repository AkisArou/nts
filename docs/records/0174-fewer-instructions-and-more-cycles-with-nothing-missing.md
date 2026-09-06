# 0174 — Fewer instructions and more cycles, with nothing missing

`generic-classes` has been published at 1.03x, at 1.16x, and measured at 0.91x
by a counted driver, all of the same bytecode -- record 0154. So this time the
instrument came first and the hypotheses came after it.

    ours   instructions 36,954   cycles 11,528   IPC 3.21
    java   instructions 39,707   cycles  8,276   IPC 4.80

**We execute seven percent fewer instructions and take thirty-nine percent more
cycles.** That is the opposite of `awfy-queens`, where the instruction count was
the whole story and IPC barely moved, and it rules out most of what this
backend's known problems are made of.

## What it is not

- **Not allocation.** `0.00 bytes/op` on both sides. Both are fully scalar
  replaced, which is record 0149 holding.
- **Not cache.** About one miss an operation on each side.
- **Not branches.** One and two an operation.
- **Not the widened counter.** `widen` holds an `i32` in a `double` slot and
  `dadd` has four times `iadd`'s latency, which would fit the symptom exactly --
  and the emitted `work$whole` contains **no `dadd` at all**. Every arithmetic
  instruction in it is integral. Refuted before it was built on.
- **Not slot traffic showing up as instructions.** 22 `istore` and 14 `iload` of
  102 bytecodes, and we still issue *fewer* instructions than the reference. If
  C2 were leaving the round trip in, this count would be higher rather than
  lower.

## What is left

A dependency chain. Fewer instructions, more cycles, no misses and no
allocation is what a longer serial chain looks like -- and store-to-load
forwarding is about five cycles where a register is zero, so slot traffic can
cost *latency* without costing *instructions*. That is consistent with record
0169, where the same traffic across an edge was worth 34% on the reference, and
it is not the same claim: 0169's cost was measured, this one is inferred from
what is left after the other four were excluded.

**Parked here rather than acted on.** The row is 1.69 us against 1.45 us -- 240
ns absolute, on a row whose published number has been wrong in both directions
-- and the next step is `-XX:+PrintAssembly` on one method, not a change. What
this record buys is that the four cheap hypotheses are now closed with numbers
instead of open.
