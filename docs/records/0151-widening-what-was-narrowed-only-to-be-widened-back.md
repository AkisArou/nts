# 0151 — Widening what was narrowed only to be widened back

Record 0150 took `optional-chain`'s 2.12x apart and found the largest piece was
two conversions HIR emits for nothing: the closure returns an `f64`, the absence
payload is typed `i32`, so every iteration narrows the result on the way in and
widens it on the way out, and the payload's only reader is the widening.

`widen.rs` is the file that decides an `i32` this backend is better off holding
as a `double`. It did not touch this class, for two reasons, and both had to
move.

## Why it did not, and what changed

**`Convert` was not an admissible definition.** `strike_down` allows a class
whose members are defined by `ConstInt`, `BlockParam`, `FieldGet` or arithmetic
that shares a representation; anything else refuses the whole class. So
`%52 = convert %24 : i32` refused this one outright. A definition that narrows
an `f64` is now admissible, because held as a `double` **it is nothing at all**
-- which is the same identity the emitter already spelled in the other
direction, and now spells in both.

**And the plan only kept a class that reaches a field**, for a reason this file
records at length:

> Widening locals alone was measured twice and lost both times. It moved two
> conversions across the entire suite -- and on `closures` it removed exactly
> one `i2d` from a 103-instruction method and cost **30%**: 1.15x to 1.49x,
> with every hot method byte-identical apart from that conversion and one
> slot's type.

That rule is right about the cases it was written for and it is not the whole
rule. What separates this class from those is that it is an `f64` narrowed
**only in order to be widened back**: every definition is a narrowing of an
`f64`, a constant, or a block parameter, and nothing computes a member. So
widening deletes two conversions from a loop and adds none, where `closures`
deleted one and relocated another.

That is `round_trip = from_f64 - computed`, and `computed` is what keeps it
narrow: a class with any arithmetic or any field read in it is excluded, which
is every class the two losing experiments were about.

## Measured

Fixed-count driver, 100,000 iterations a call, two-point at 200 and 400 calls,
three repetitions, medians.

| | instructions/iteration | cycles/iteration |
| --- | ---: | ---: |
| hand-written Java | 11.0 | **2.06** |
| ours, before | 17.1 | **4.31** |
| ours, after | 13.6 | **2.12** |

**4.31 to 2.12 cycles**, and 1.03x the reference where it was 2.09x. Better than
the 2.96 the probe in 0150 predicted, which kept the tag and payload as two
`int`s: with the payload a `double` the whole join is one representation and C2
gets more than the two conversions back.

Same checksum, verifies under `-Xverify:all`, no new declines across 109
examples and 50 bench cases, jvm gate green at 107 of 109.

Timed, under the lock:

| row | before | after |
| --- | ---: | ---: |
| `optional-chain` | 2.12x | **1.01x** |
| `instanceof` | 1.09x | **1.00x** |

`instanceof` was not predicted and is the same shape found a second time.

## What it does not touch, checked rather than assumed

The rows this file records losing on, emitted after the change, still carry
their conversions -- `closures` five `d2i` and seven `i2d`, `module-closures`
eight and ten, `objects` six `i2d` -- because their classes compute members
rather than only carrying them, and `computed` excludes them. The predicate is
narrow by construction and the survey says it stayed narrow.

Timed as well as counted, because a survey of emitted instructions is not the
thing that lost 30% last time. `closures` 0.85x, `module-closures` 1.06x,
`objects` 0.99x, `logical-assignment` 0.93x, `generator` 1.02x, `upcast` 1.03x,
`in-narrowing` 1.01x, `absences` 1.22x, `loop` 0.75x, `fib` 1.03x, `checksum`
1.00x, `accumulate` 1.00x, both `erasure-*` 1.00x -- every one within noise of
where it was.
