# Two guards, each blind to the other's sabotage

Record 0279 named three invariants and fixed three defects. It did not say
whether anything could tell if they came back. This is that check, and it found
that the answer depended on *which way* the invariant was broken.

## The three, forced

Each invariant was broken in the compiler, the compiler rebuilt, and the
relevant instrument run. Restoring returned `target/release/nts` to
`3cf7f125` — the baseline hash, byte for byte — which is the check that the
sabotage left nothing behind.

**Invariant 1 — an index's member name comes from its type, not its text.**
`indexed_member_name` patched to return `None`, so `literal_name`'s text answers
again:

    NTS1001 `namedKey`, which `Keyed` does not declare
    checked 145 cases across 5 function(s)
    agreed on every case

**The fixture went green with the defect live.** `nts check` compiles what it
can, runs that, and reports agreement over the functions that survived — six
functions became five and the verdict line did not change. This is the failure
mode `all.sh:541` already describes for `examples/in-on-a-native-receiver`, met
again by a fixture written after it.

**Invariant 2 — an index that names no single member is not a property.**
`names_one_member`'s fallback flipped to `true`. The false sentence came back —
`` NTS1001 `i`, which `UnknownArrayLike` does not declare `` — and
`blockers-check.mjs` said `CHANGED an-index-signature-is-not-an-array: refuses
differently`. That guard works, because it asserts on the refusal *text* and the
text is what was wrong.

**Invariant 3 — a computed field name must be initialized.**
`initialize_fields`' `symbol_member_name` fallback removed:

    nts  bySymbol 18 0000000000000000
    node bySymbol 18 401c000000000000
    Error: 28 case(s) disagree

Caught outright, by the differential, on the answer. `bail!` exits non-zero.

## The decoy, and what it revealed

Invariant 1 was the weak one, so `Keyed` gained a field named `namedKey` — the
*spelling of the variable* that holds `"named"`. Now reading the text finds
something instead of nothing, and the sabotage answers 99 where node answers 3:
28 cases disagree, and the example fails at the thing it was written for.

Then the same run measured the ledger:

    --- ledger count under sabotage: 0

**The fix that made one guard work made the other stop working.** With no decoy
the sabotage refuses: `example-refusals` counts it, the differential says
"agreed". With the decoy it answers wrongly: the differential catches it, the
ledger counts zero. One invariant, two ways to break it, and each guard is blind
to the way the other one sees.

Neither guard is wrong and neither is redundant. The lesson is that "is this
covered?" has no answer until the *form* of the regression is named — a refusal
and a wrong answer are different failures of the same rule, and a fixture that
catches one is evidence about that one only. The pair is the coverage; either
alone reads as complete and is not.

That is also why the decoy is documented in the fixture rather than left as a
field with an odd name. A future reader deleting `namedKey = 99` as unused would
take the example from failing-on-defect to green-on-defect without touching a
line that looks like a guard.

## What is now covered

| invariant | positive | what fails on regression |
| --- | --- | --- |
| name from type, not text | `byVariableLiteral` answers 3 | differential, 28 cases (decoy) |
| no single member ⇒ not a property | blocker's `viaRealArray`, `viaLength` | `blockers-check`, refusal text |
| computed field names initialized | `bySymbol` answers 7 | differential, 28 cases |

See [[0279]] for the defects themselves and `all.sh:541` for the partial-refusal
hole in `nts check` that started this.
