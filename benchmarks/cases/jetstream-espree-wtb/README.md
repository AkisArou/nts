# JetStream 3: Espree Web Tooling Benchmark

This real-code row tokenizes and parses all four complete original programs
using Espree 10.4.0 and Acorn 8.15.0. It has no C++ reference.

## Source and licences

The release pin is
`WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b`.

- [Exact bundled parser and dependencies](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/dist/espree.bundle.js)
- [Original workload](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/src/espree.mjs)
- [JetStream wrapper](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/benchmark.js)
- [Exact component notices](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/dist/espree.LICENSE.txt)
- [Workload licence and input credits](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/LICENSE)

Espree uses BSD-2-Clause; Acorn, acorn-jsx and the four input programs use MIT;
eslint-visitor-keys uses Apache-2.0. The V8 workload uses BSD-3-Clause and Apple
wrapper BSD-2-Clause. The exact bundled component notices are appended to
`../LICENSE-jetstream`; original notices remain in source comments and complete
input strings.

## Transcription

The complete parser, token translator, JSX plugin, XHTML entity table and visitor
keys remain present. The Acorn ESM module is byte-identical to the version in the
Acorn WTB bundle before transcription. Its classes and checked AST readers follow
that port. The separate CommonJS Acorn peer namespace is also retained, preserving
the JSX plugin's distinction between peer token identities and actual parser token
identities. No npm parser executes at runtime.

Webpack's static module/export wiring becomes local imports/exports. The JSX
factory and its exported `tokTypes` getter live in a typed export object, with
the same lazy getter body. Constructor functions/prototype methods become classes
with declared layouts. The original token objects are still mutated from Acorn
token kinds into Esprima kinds; their declared union reflects this transition.
Checked readers narrow AST fields at the grammar sites establishing their shape,
and non-null annotations express existing control-flow invariants. Typed
`Parser.extend` overloads describe the original sequential application of plugins.

The original four input strings, options, tokenizer calls, parse calls and counts
remain unchanged. `work(n)` repeats that complete operation, observing all four
counts in an unsigned polynomial checksum. The original success criterion is
completion with those counts. Untimed exports expose complete ASTs and tokens for
independent correctness checks.

### Initialization operations retained

The original library performs **91 `Object.freeze` calls during module
initialization** to freeze visitor-key arrays, their map and the exported Syntax
map. An instrumented run of the untouched bundle records **0 freeze calls during
one complete original operation**. These calls remain unchanged in the port;
module loading is outside work. The dormant `unionWith` helper also keeps its
original freezing operations. Any nts refusal is for maintainers to record.

## Validation

The untouched pinned bundle ran separately under Node **24.20.0**. Every input
string matched the original bytes. Every complete AST and token array matched
the original bundle's JSON serialization byte for byte, including locations,
ranges, comments, values and node fields. `source-audit.json` records each digest.
An additional untimed JSX/template/regexp/comment fixture also matches upstream.

| Original input | Tokens | Tokens plus top-level statements |
| --- | ---: | ---: |
| `backbone-1.6.1.js` | 11,316 | 11,317 |
| `jquery-3.7.1.js` | 44,605 | 44,606 |
| `mootools-core-1.6.0.js` | 38,365 | 38,429 |
| `underscore-1.13.7.js` | 10,686 | 10,687 |

`work(0) = 0`, `work(1) = 381213099`, `work(2) = 214361558`.
The Float64 checksum bits for `work(1)` are `41b6b8d9ab000000`.

Validation commands, using `.tool-versions` and `packageManager`:

```sh
pnpm install
pnpm exec tsc --ignoreConfig --strict --noEmit --skipLibCheck --target es2024 --module nodenext --allowImportingTsExtensions benchmarks/cases/jetstream-espree-wtb/case.ts
node --test benchmarks/jetstream.test.ts
```

The exact shared-test layout reports **8 tests, 8 passed, 0 failed, 0 skipped**.
Strict TypeScript 7.0.2 passes. A syntax-tree audit finds no `any`, type assertion,
`as` cast or type-check suppression in the port. Tests contain no timing checks.

## Timing exception

**Approved complete-operation timing exception: 61.002504 ms at `seed = 1`
under Node 24.20.0.** One is the smallest positive whole-operation count, and the
call still tokenizes and parses all four complete original inputs.

The unchanged `benchmarks/common/bench.mjs` measured five sequential fresh
processes with its own warmup, calibration and five timed trials per process.
The process minima were **61.002504, 67.975592, 61.352676, 65.838897 and
64.694449 ms**. These are local scale observations, not nts measurements.
Maintainers own nts compilation, domains, oracle-count recording and measurement.
