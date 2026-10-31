# JetStream 3.0: WSL

This row retains the complete WSL language implementation, generated standard
library and all 285 original tests from
[`WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b`](https://github.com/WebKit/JetStream/tree/3967678fa8ab98d847ab33cf3728dba726fa854b/WSL).
The inventory's 148 source files are concatenated in their original order in
`wsl.ts`; every original BSD-2-Clause header remains. `source-audit.json` lists
all source paths and SHA-256 hashes. Copyright (C) 2017 Apple Inc. All rights
reserved. The complete notice is also in `../LICENSE-jetstream`.

## Complete operation and input

Each opaque `work(n)` iteration runs the original `Benchmark.buildStdlib()` and
`Benchmark.run()` once. These are the two phases measured by the original
JetStream WSL driver. The main phase sorts the original registry and runs every
test, including its own validation, error assertions, lexer checks, compiler
passes and interpreter checks. All 365 test template literals and all five
standard-library template literals match their original bytes.

A JetStream trial receives fresh module bindings. To repeat complete trials
without loading source inside `work`, the wrapper clears the original prepare
closure's cached raw standard-library AST and resets its existing allocation
counters and allocation-permission flag. The complete source, generated
standard-library text and original test registry remain initialized outside
work. Standard-library parsing still occurs in the original preparation phase;
its cache is retained throughout that trial's 285 tests.

The original operation allocates 97,397 EBuffers and 1,392 anonymous variables.
The wrapper observes those existing counters and folds them as
`(eBuffers * 31 + anonymousVariables) >>> 0`, then folds repeated trials with
`(checksum * 31 + value) >>> 0`. Thus `work(0/1/2)` returns
`0 / 3020699 / 96662368`; `seed = 1` has Float64 bits `41470bcd80000000`.
`inspect()` runs a complete trial and returns its counters and sorted test names
for correctness checks outside measurement.

This is a real-code row against Node and Bun, with no C++ reference. Input
domains, node oracle-count recording, nts compilation, the gate and compiled
measurements are maintainer work.

## Runtime prototype operation: deliberately retained

`Value.become`, from `WSL/Value.js`, retains the literal original assignment:

```ts
this.__proto__ = IdentityExpression.prototype;
```

It changes the existing receiver while preserving aliases, then stores the
original origin and new target. It performs **22,354 prototype changes per
complete operation: 3,620 in standard-library preparation and 18,734 in the
main suite**. The untouched release and final typed port match those counts,
every receiver/target class count, both allocation counters and all test names.
A scratch observer checked alias identity, replacement prototype and target
after every call; it is absent from the measured case. A second fresh typed
trial matches the first.

The original `Proxy` test registry and `set` trap also remain: one construction
and 285 registrations during module initialization; no Proxy construction or
registry writes during work. The user explicitly approved retaining WSL's
runtime object operations. Any nts refusal is the compiler finding and a future
support target; this port does not replace the prototype change with tags or
forwarding.

## TypeScript transcription

All 116 original classes remain, with 301 explicitly declared fields and typed
base contracts. No original definition is removed. A literal-preserving audit
accounts for 1,254 original functions, constructors, methods, accessors,
initializers and tests. After erasing TypeScript syntax and normalizing the
listed checked readers, 1,237 match directly; the remaining 17 definitions have
individually documented adaptations in `source-audit.json`. All 285 test bodies
match under that normalization.

The port has no `any`, escaping assertion, `as` cast, diagnostic suppression,
untyped JavaScript import or replacement implementation. Existing nullable
phase invariants use 369 erased non-null annotations. Dynamic visitor and
formatter calls preserve their receiver and argument order. Checked instance,
array, numeric and callback readers narrow values before use; these checks
remain in the measured program. They preserve the original objects and arrays.
Abstract getter contracts describe original absent properties without adding
runtime getters. The TypeScript declarations for primitive string
property reads reflect the unchanged built-ins.

Other adaptations are concrete: explicit `Number` conversions preserve the
original unsigned-literal and bitwise-AND coercions; a local union expresses a
protocol reference becoming its declaration; typed implementation-data aliases
preserve identity; a return of `undefined` spells an original implicit return.
The original dormant missing-name, missing-argument and numeric-key behaviors
remain, including `typeArgument[i]`, the five-argument LexerToken call, and the
class-call error paths. Original error checks and call arities are preserved.

## Validation

With Node **24.20.0**, pnpm **10.15.0** and TypeScript **7.0.2**:

```text
pnpm install                                              PASS
node --test benchmarks/jetstream.test.ts                  9/9 PASS
pnpm exec tsc --ignoreConfig --strict --noEmit --skipLibCheck \
  --target es2024 --module nodenext --allowImportingTsExtensions \
  benchmarks/cases/jetstream-wsl/case.ts                   0 diagnostics
```

Tests cover complete original assertions/counters, every original input
template, prototype replacement and alias identity, and stable opaque-count
repetition. No test depends on a timer. The scratch differential audit runs all
148 untouched release files in a fresh VM and compares them with the final typed
port. Full per-file provenance, counts, test names and adaptation details are in
`source-audit.json`.

## Local scale and approved timing exception

A single complete original operation exceeds 10 ms. **Approved timing exception:
8,307.094613 ms at seed 1 under Node 24.20.0.** Both original phases, the full
standard library and all original tests remain.

Five sequential fresh processes using the unchanged `benchmarks/common/bench.mjs`
helper measured **8307.094613, 8635.396485, 8866.647351, 8336.485348 and
8958.416256 ms** per complete operation. Every process returned bits
`41470bcd80000000`. Other heavy checks were paused during this timing window.
These are local scale observations; maintainers make the benchmark measurements.
