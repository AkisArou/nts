# 0173 — A u32 in an int slot is negative above two billion, and the only lane with the type agreed with node

    nts (JVM)  41de7d8dc2800000   2,046,179,082
    node       41de7d8dd0400000   2,046,179,137
    nts (C)    agreed on every case

`benches/cases/absences` with pool value 20, which is `2147483647`. A wrong
answer, in the lane whose verifier this project keeps calling the better
instrument.

## The bug

`n = 256 + (seed | 0)` is 2,147,483,903, so the loop counter passes 2^31, and
the prepared HIR converts it to a **u32** for each remainder:

    %124 = convert %11 : u32
    %125 = convert %16 : u32
    %17 = rem %124, %125 : u32

A `u32` is held in an `int` slot here, raw, because the JVM has no unsigned
type -- so every value above 2^31 is a *negative* `int`, and `irem` answers with
the sign of a dividend that has no sign. `(-2147483648) % 3` is `-2` where
`2147483648 % 3` is `2`, so `i % 3 === 0` takes the wrong arm for half the
remaining iterations.

The C lane agreed with node because C has the type. This is the one line the
plan already wrote down and nobody had connected to a row:

> **Unsigned arithmetic**, which needs `Integer.divideUnsigned`/`compareUnsigned`
> where C has a type.

Fixed with `uidiv`/`uirem`/`uldiv`/`ulrem`, which are the signed helpers with
`Integer.divideUnsigned` and friends inside. Java 8 and Android 24, inside both
floors this jar keeps.

## Why nothing saw it, which is the part worth keeping

- `jvm` in the gate runs **examples**. This is a bench case.
- `benches.sh` compiles every bench case and its header says so: *"Nothing
  runs."*
- `nts-bench` runs each case with **one seed** and compares a checksum. The
  case's own seed is 3, which never reaches 2^31.

So a case that is wrong on a hostile pool value is green in all three, on the
lane that has the verifier. **A green step is a claim about what it looked at,
and this one's scope was never written down** -- which is nts-69's *"a refusal
is a claim, and it ages"* with the sign flipped.

`nts check` over all fifty bench cases found exactly this one, and nine that
report "nothing to check: no exported function has scalar arguments and a
scalar result". That sweep is now a gate step.

## And the fix made the case look like a refusal

With the correct unsigned remainder the case takes **14.74 s** for its 2.1
billion iterations, past the differential's timeout, and the differential
reported it as *declined* -- the same word it uses for a program that correctly
refuses its input.

    1 case(s) the compiled program declined -- an index its `!` promised was
    in range and was not, most often

That is the standing rule broken by my own instrument: **a refused construct and
an unmeasurable one must never look alike.** Before the fix the case was fast
and wrong; after it, slow and indistinguishable from a refusal. The second state
is better and is still not honest.

Run by hand it answers `41de7d8dd0400000`, which is node's.
