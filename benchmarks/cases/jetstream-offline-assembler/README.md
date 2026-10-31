# JetStream 3: OfflineAssembler

This row transcribes JetStream 3.0's complete OfflineAssembler parser and AST
workload. One operation resets the original AST maps and parses
`LowLevelInterpreter.asm`, including its three in-memory input files. The
complete original assembly strings and all **5,669 expected AST lines** remain
unchanged. This real-code row compares with Node and Bun without a C++ reference.

## Source and licence

The source is pinned to
`WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b`, under
[RexBench/OfflineAssembler](https://github.com/WebKit/JetStream/tree/3967678fa8ab98d847ab33cf3728dba726fa854b/RexBench/OfflineAssembler):

- `registers.js`, `instructions.js`, `ast.js`, `parser.js`, `file.js`;
- `LowLevelInterpreter.js`, `LowLevelInterpreter32_64.js`,
  `LowLevelInterpreter64.js`, `InitBytecodes.js`;
- `expected.js` and `benchmark.js`.

All code and embedded assembly input use **BSD-2-Clause**. Complete Apple
2011–2017, 2014, 2016–2017 and 2017 notices remain in `program.ts` and are
reproduced in `../LICENSE-jetstream`. The original generated `expected.js`
contains the AST dump derived from those permitted inputs, rather than another
program or executable code. Exact source hashes are in `source-audit.json`.

`program.ts` statically joins the original files in their release order. Each
section names its exact source path. The four input files are byte-for-byte
identical, including their embedded notices. The expected-lines file differs
only by its exported typed binding; tests recover and hash the complete original
file. No input, branch, assembly line, instruction set or expected line is cut.

## Transcription and fidelity

The original `Benchmark` constructor, `runIteration` and `validate` ASTs are
identical after type erasure and export removal. The parser, AST classes,
original per-file directory, memoization maps, reset operations, token values,
loop order and all original line-by-line validation remain.

`work(n)` repeats the complete original parse `n` times. Its bounded observer
mixes the final root list length and source-line numbers of its immediate
children. It does not dump the AST. The original driver validates after timing;
`render` retains that boundary, invokes the original validation and returns the
complete AST dump for independent checks.

Type and packaging adaptations are explicit:

- Class fields, mappings, lexical-token unions, method parameters and return
  types are declared. Static script bindings become one module. Erased
  non-null annotations retain the source's existing invariants. There is no
  `any`, escaping assertion or suppression.
- RegExp and `parseInt` calls spell the source's existing string coercion
  explicitly where a token may contain a number or an object. The scale test
  retains strict `includes` semantics through an explicitly typed local array.
  An empty comment branch becomes an empty block because TypeScript rejects
  the source's empty-statement spelling.
- The source's `!value instanceof Constructor` precedence is preserved by a
  checked `sourceInstanceOf` helper; it is not corrected to the different
  expression `!(value instanceof Constructor)`.
- Typed helpers preserve optional legacy member reads and callable checks.
  The original unbound names are ambient declarations only, so a dormant use
  still fails instead of obtaining a replacement implementation. The
  `.include` typo and `.dirname` read on a method are retained.
- The dormant `Annotation` constructor still assigns its getter-only
  properties in the original order, through a typed indexed-write helper.
  Construction throws on the first assignment with the original TypeError.
  Its recursive getters are not repaired.
- The source overwrites `True.instance` and `False.instance` methods with
  singleton objects. Checked union-typed aliases retain those assignments;
  attempting the original calls still throws. The unused `SpecialRegister`
  constructor's missing-`super` failure is retained by a throwing argument
  evaluated before the typed `super` call; its original field assignment
  remains after that unreachable point.
- Checked helpers type dormant value/diagnostic operations without repairing
  them or supplying manufactured AST values. None of the original failing
  paths is selected by the complete released workload.

The four recorded dormant failures—Annotation construction, SpecialRegister
construction, and the `true`/`false` singleton calls—were compared with untouched
upstream and retain their exact error class and message. The suite also checks
Annotation and the two singleton failures. The point is to preserve this
specific released program, including its defects.

## Validation

Untouched pinned scripts were loaded in their release order and executed under
**Node 24.20.0**. Both upstream and port pass every original AST-line check.
Their complete AST dumps match byte for byte across repeated operations:

| Observation | Result |
| --- | ---: |
| Complete AST dump characters | 178,076 |
| Original expected lines | 5,669 |
| `seed` | 1 |
| `work(0)` | 0 |
| `work(1)` | 1,823,231,877 |
| `work(2)` | 2,508,845,216 |
| Float64 checksum bits | `41db2b13e1400000` |

Complete dump SHA-256:
`28257369b7f67d4df464b4d984dd86d32f9205f0b85476a73ff9ad2db29c0a6d`.

```sh
pnpm install
pnpm exec tsc --noEmit --strict --target ESNext --module NodeNext \
  --moduleResolution NodeNext --allowImportingTsExtensions --skipLibCheck \
  benchmarks/cases/jetstream-offline-assembler/case.ts
node --test benchmarks/jetstream.test.ts
```

Strict TypeScript passes. The exact PR layout passes **9 tests, 9 passed,
0 failed, 0 skipped**. Tests verify complete input hashes, full AST output,
original validation, preserved dormant failures, repeated-call stability and
opaque counts. No test contains timing or a speed-dependent assertion.

## Timing exception

The unchanged `benchmarks/common/bench.mjs` measured five sequential fresh
Node 24.20.0 processes, each with its original warmup, calibration and best of
five trials. Process minima at `seed = 1` were **26.2436710, 23.0069027,
24.1534218, 28.1837507 and 28.7459055 ms**. The best local result is
**23.0069027 ms**.

**Approved timing exception:** one is already the smallest positive count of
complete original operations. The full parser input is retained under the
accepted policy for operations exceeding 10 ms. These local numbers establish
scale; maintainers perform nts compilation, the gate, input-domain selection,
oracle-count recording and final measurements. No compiler or harness change
is included.
