# JetStream 3: Babylon Web Tooling Benchmark

This real-code row parses all ten complete original JavaScript and JSX input
programs with Babylon 7.0.0-beta.32. It has no C++ reference.

## Source and licences

The release pin is
`WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b`.

- [Exact bundled parser](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/dist/babylon.bundle.js)
- [Original workload](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/src/babylon.mjs)
- [JetStream wrapper](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/benchmark.js)
- [Component notice](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/dist/babylon.LICENSE.txt)
- [Workload licence and input credits](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/LICENSE)

Babylon uses MIT, the V8 workload BSD-3-Clause, the Apple wrapper BSD-2-Clause,
and all ten input programs MIT. The complete input strings retain their original
notices. `../LICENSE-jetstream` reproduces the workload grant, input credits and
exact bundled Babylon notice. The JSX fixtures are the original TodoMVC React
files; they are parsed as data, not executed.

## Transcription

`parser.ts` retains the complete bundled parser, including all Flow, TypeScript,
JSX and ESTree plugin bodies, Unicode tables, tokenizer, comments and grammar
checks. Webpack's static module/export wiring becomes local imports and exports.
Browser input loading becomes the same full input strings in `sources.ts`, before
work. No parser dependency is loaded from npm at runtime.

Constructor functions and their installed prototype methods become classes with
declared fields. Compiled inheritance helpers become ordinary `extends` and
`super` construction, preserving the original hierarchy and method bodies.
Forward interface declarations describe methods supplied by the parser's later
layers. Incrementally populated AST fields retain their unions. Checked readers
narrow these unions at grammar sites establishing their concrete shape; non-null
annotations express the original control-flow invariants. The options object
has a declared layout with the same copying and normalization operations.

The `runTest` body keeps every input and its exact options. Its map callback now
returns the parsed root so `work(n)` can observe each completed parse's `end`
field in an unsigned polynomial checksum. It performs no added AST traversal.
`n` repeats the whole ten-input operation. The original workload's success
criterion is that every parse completes without throwing; all those parses
remain in the row. Untimed exports expose full ASTs for independent correctness
checks.

## Validation

The untouched pinned bundle and its exact parser body ran separately under Node
**24.20.0**. Every input string matched the original bytes. Every complete AST
matched the original parser's JSON serialization byte for byte, including all
positions, comments and node fields. `source-audit.json` records the original
bundle digest and each input/output digest. Additional untimed fixtures compare
all four retained plugin families against untouched upstream.

| Original input | Input characters | Full AST JSON characters |
| --- | ---: | ---: |
| `jquery-3.7.1.js` | 285,314 | 6,248,361 |
| `lodash.core-4.17.21.js` | 115,957 | 1,206,646 |
| `preact-8.2.5.js` | 20,772 | 528,136 |
| `redux-5.0.1.min.js` | 10,326 | 283,772 |
| `speedometer-es2015-test-2.0.js` | 24,849 | 477,552 |
| `todomvc/react/app.jsx` | 5,457 | 107,846 |
| `todomvc/react/footer.jsx` | 1,338 | 36,931 |
| `todomvc/react/todoItem.jsx` | 2,926 | 67,560 |
| `underscore-1.13.7.js` | 68,766 | 1,441,726 |
| `vue-3.5.18.runtime.esm-browser.js` | 368,334 | 8,614,672 |

`work(0) = 0`, `work(1) = 3366597289`, `work(2) = 985130514`.
The Float64 checksum bits for `work(1)` are `41e9154655200000`.

Validation commands, using `.tool-versions` and `packageManager`:

```sh
pnpm install
pnpm exec tsc --ignoreConfig --strict --noEmit --skipLibCheck --target es2024 --module nodenext --allowImportingTsExtensions benchmarks/cases/jetstream-babylon-wtb/case.ts
node --test benchmarks/jetstream.test.ts
```

The exact shared-test layout reports **8 tests, 8 passed, 0 failed, 0 skipped**.
Strict TypeScript 7.0.2 passes. A syntax-tree audit finds no `any`, type assertion,
`as` cast or type-check suppression in the port. Tests contain no timing checks.

## Timing exception

**Approved complete-operation timing exception: 54.321999 ms at `seed = 1`
under Node 24.20.0.** One is the smallest positive whole-operation count, and
the call still parses all ten complete original inputs.

The unchanged `benchmarks/common/bench.mjs` measured five sequential fresh
processes with its own warmup, calibration and five timed trials per process.
The process minima were **65.085525, 54.321999, 66.165665, 59.611438 and
59.321881 ms**. These are local scale observations, not nts measurements.
Maintainers own nts compilation, domains, oracle-count recording and measurement.
