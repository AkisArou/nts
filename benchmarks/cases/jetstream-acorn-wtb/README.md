# JetStream 3: Acorn Web Tooling Benchmark

This real-code row tokenizes, parses and walks all eight complete original
programs with Acorn 8.15.0 and acorn-walk 8.3.4. It has no C++ reference.

## Source and licences

The release pin is
`WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b`.

- [Exact bundled parser and walker](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/dist/acorn.bundle.js)
- [Original workload](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/src/acorn.mjs)
- [JetStream wrapper](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/benchmark.js)
- [Component notices](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/dist/acorn.LICENSE.txt)
- [Workload licence and input credits](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/LICENSE)

Acorn and acorn-walk use MIT; the V8 workload uses BSD-3-Clause, the Apple
wrapper BSD-2-Clause, and all eight input programs MIT. Original notices remain
inside the complete input strings. `../LICENSE-jetstream` includes the workload
grant, input credits and the exact two bundled component notices, including
acorn-walk's separate 2012–2020 copyright notice.

## Transcription

`parser.ts` and `walker.ts` retain the exact distribution's algorithms, grammar,
Unicode tables, token contexts, scope checks, regular-expression validation and
walker implementations. Webpack's static module/export machinery becomes local
imports. Its `self.WTBenchmark` assignment becomes module exports. Browser input
loading is replaced by the same complete strings in `sources.ts`, before work.
None of these input programs is executed.

Constructor functions and their installed prototype methods become classes with
declared fields. The parser's installed accessors become class getters. The
options record has a declared class layout; the same option-copy and normalization
operations populate it. A typed rest parameter replaces the
`arguments` copy in the unused `Parser.extend` entry point. Incrementally built
AST fields retain their actual unions; checked readers narrow those unions at
grammar sites that establish their shape. Non-null annotations describe the
original parser's existing control-flow invariants. The empty `if` body in the
Unicode-set parser is spelled `{}` because strict TypeScript rejects `if (...);`.

The original `runTest` body and options are retained, with imports and type
annotations. It still counts every tokenizer result, parses with locations and
ranges, then counts every callback from `walk.full`. `work(n)` repeats that
complete operation and observes all eight returned counts in an unsigned
polynomial checksum. The output remains live only as long as in the original
workload; no AST cache or replacement parser is introduced.

## Validation

The untouched pinned bundle was run separately under Node **24.20.0**. Every
input string matched the original byte hash. Every complete parsed AST and token
array matched the untouched parser's JSON serialization byte for byte, including
all positions, ranges, values and node fields. `source-audit.json` records each
input digest and the independent full-output digests.

| Original input | Tokens | Tokens plus walker callbacks |
| --- | ---: | ---: |
| `backbone-1.6.1.js` | 11,316 | 18,479 |
| `jquery-3.7.1.js` | 44,605 | 73,648 |
| `lodash.core-4.17.21.js` | 7,507 | 12,608 |
| `preact-8.2.5.js` | 4,358 | 7,354 |
| `redux-5.0.1.min.js` | 2,318 | 3,880 |
| `speedometer-es2015-test-2.0.js` | 3,485 | 5,760 |
| `underscore-1.13.7.js` | 10,686 | 17,842 |
| `vue-3.5.18.runtime.esm-browser.js` | 71,110 | 117,058 |

`work(0) = 0`, `work(1) = 2288699203`, `work(2) = 117939078`.
The Float64 checksum bits for `work(1)` are `41e10d58e8600000`.
The original success criterion is completing tokenization, parsing and walking
and returning the per-input counts. All of those operations remain in the row.

Validation commands, using `.tool-versions` and `packageManager`:

```sh
pnpm install
pnpm exec tsc --ignoreConfig --strict --noEmit --skipLibCheck --target es2024 --module nodenext --allowImportingTsExtensions benchmarks/cases/jetstream-acorn-wtb/case.ts
node --test benchmarks/jetstream.test.ts
```

The exact shared-test layout reports **7 tests, 7 passed, 0 failed, 0 skipped**.
Strict TypeScript 7.0.2 passes. A syntax-tree audit finds no `any`, type assertion,
`as` cast or type-check suppression in the port. Tests contain no timing checks.

## Timing exception

**Approved complete-operation timing exception: 90.325335 ms at `seed = 1`
under Node 24.20.0.** One call still processes all eight complete original input
programs. One is the smallest positive whole-operation count; the inputs are not
reduced to meet the 10 ms target.

The unchanged `benchmarks/common/bench.mjs` measured five sequential fresh
processes, with its own warmup, calibration and five timed trials in each.
The process minima were **90.325335, 93.970218, 106.826275, 99.685071 and
107.782713 ms**. These are local scale observations, not nts measurements.
Maintainers own nts compilation, domains, oracle-count recording and measurement.
