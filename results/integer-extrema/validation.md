# Integer extrema verification

The compiler and JVM owners reviewed the shared proof and emission changes. Format, workspace clippy with warnings denied, the core and all four backend test crates, and the native frontend tests passed (1767 Rust tests). The complete workspace was built with plain cargo build --release before preparing the paired artifacts.

The new fixture compares all 14 exports on four backends and both native RC/POISON configurations: 406 of 406 cases each, with no declines, timeouts or unreached cases. It covers observed negative zero through reciprocal and Object.is, fractional inputs, NaN/infinity, full-width unsigned operands and merge positions. A structural check proves integer Min/Max on the new compiler and fails for the old shape. The old JVM emitter refuses the new unsigned tests; restored emission passes all 36 uint32 and 25 uint64 ordered pairs under -Xverify:all.

## Scope

All 93 benchmark programs were listed before and after. No benchmark TypeScript source calls Math.min or Math.max directly. The only programs gaining integer selections are array-copying-methods, map-entries-top-k, sort-objects. All are measured, with array mutations/splice, array methods, typed-view copyWithin, ownership and direct extrema controls.

Sort's prepared merge positions are i64 on the shared HIR path. Native assembly removes six float-to-integer address conversions from each of two emitted merge-loop copies (work: 15 to 3 static vcvttsd2si instructions on both C and LLVM; the remaining three are input coercions). The snapshot and index storage, comparator and RC policy are unchanged.

## Broad comparisons

The before executable is the retained count-free-sort release compiler built from 3f25d11da, whose compiler/runtime/CLI/build inputs are byte-identical to landed base e80073590754. The after executable was built from 35180fa1eaf8b4f4d61aa7a17935dce868375b6b. These are retained build outputs rather than pin.ts artifacts; exact paths and commands are in the raw directory.

### test262-cases.stdout

```text
  recorded cases: 6974 of 8367 pass -- not a conformance rate; the denominator is not the suite
         0  REGRESSED
         0  CHANGED
         0  MISSING
  reconciled
```

### test262-builtins-cases.stdout

```text
  recorded cases: 828 of 1034 pass -- not a conformance rate; the denominator is not the suite
         0  REGRESSED
         0  CHANGED
         0  MISSING
  reconciled
```

### test262-rest-cases.stdout

```text
  recorded cases: 9 of 12 pass -- not a conformance rate; the denominator is not the suite
         0  REGRESSED
         0  CHANGED
         0  MISSING
  reconciled
  recorded cases: 53 of 58 pass -- not a conformance rate; the denominator is not the suite
         0  REGRESSED
         0  CHANGED
         0  MISSING
  reconciled
  recorded cases: 17 of 17 pass -- not a conformance rate; the denominator is not the suite
         0  REGRESSED
         0  CHANGED
         0  MISSING
  reconciled
```

### c

```text
  770 example(s), 4 at a time, backend c, rc off
  748 agree, 10 agree on part of their cases, 12 compared nothing, 0 wrong, 0 not measured
  137427 of 138084 case(s) compared; not compared: 110 declined, 0 timed out, 547 unreached (node stopped part-way in 2 example(s))
  770 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not measured, in 241 s
```

### llvm

```text
  770 example(s), 4 at a time, backend llvm, rc off
  748 agree, 10 agree on part of their cases, 12 compared nothing, 0 wrong, 0 not measured
  137427 of 138084 case(s) compared; not compared: 110 declined, 0 timed out, 547 unreached (node stopped part-way in 2 example(s))
  770 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not measured, in 141 s
```

### jvm

```text
  770 example(s), 4 at a time, backend jvm, rc off
  748 agree, 10 agree on part of their cases, 12 compared nothing, 0 wrong, 0 not measured
  137427 of 138084 case(s) compared; not compared: 110 declined, 0 timed out, 547 unreached (node stopped part-way in 2 example(s))
  770 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not measured, in 231 s
```

### wasm

```text
  770 example(s), 4 at a time, backend wasm, rc off
  wrong, both   array-with                                       backend declined
  747 agree, 10 agree on part of their cases, 12 compared nothing, 1 wrong, 0 not measured
  137018 of 137562 case(s) compared; not compared: 232 declined, 0 timed out, 312 unreached (node stopped part-way in 2 example(s))
  770 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not measured, in 129 s
```

### c RC/POISON

```text
  770 example(s), 4 at a time, backend c, rc on, poison on
  748 agree, 10 agree on part of their cases, 12 compared nothing, 0 wrong, 0 not measured
  137427 of 138084 case(s) compared; not compared: 110 declined, 0 timed out, 547 unreached (node stopped part-way in 2 example(s))
  770 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not measured, in 226 s
```

### llvm RC/POISON

```text
  770 example(s), 4 at a time, backend llvm, rc on, poison on
  748 agree, 10 agree on part of their cases, 12 compared nothing, 0 wrong, 0 not measured
  137427 of 138084 case(s) compared; not compared: 110 declined, 0 timed out, 547 unreached (node stopped part-way in 2 example(s))
  770 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 0 not measured, in 225 s
```

The runtime-module C compilation, refusal diff and RC emission diff also passed. No refusal ledger, baseline or gate selector was edited. Paired performance uses five A/B/A brackets and five separate launches per host; every loss and repeat floor remains in the table. This change contains no C comparison-chain optimization.

Raw data and reproducing scripts: /home/akisarou/.cache/nts-scratch/runtime-20261027/integer-loop-facts.

## Rebased Rust refresh

Rebased cleanly onto bcba26f9bdacbd7327ba30a2d894b0a4d6bede7c. The six compiler/fixture files are byte-identical to measured source 35180fa1e. Format, workspace clippy, core and all four backend crates, and the native frontend tests passed again: 1768 Rust tests. The measured C/LLVM programs and all raw data remain unchanged.
