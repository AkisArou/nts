# JetStream 3: Esprima-next Web Tooling Benchmark

This real-code row tokenizes and parses all four complete original programs
using Esprima-next 6.0.3. It has no C++ reference.

## Source and licences

The release pin is
`WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b`.

- [Exact bundled parser](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/dist/esprima-next.bundle.js)
- [Original workload](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/src/esprima-next.mjs)
- [JetStream wrapper](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/benchmark.js)
- [Exact component notice](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/dist/esprima-next.LICENSE.txt)
- [Workload licence and input credits](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/LICENSE)

Esprima-next uses BSD-2-Clause, the V8 workload BSD-3-Clause, the Apple wrapper
BSD-2-Clause, and the four input programs MIT. The exact bundled component
notice is appended to `../LICENSE-jetstream`; original notices remain in
source comments and complete input strings.

The parser's original TypeScript source comes from
[`node-projects/esprima-next@242fb79474f623c0efba35a25fa96ea48e0db35d`](https://github.com/node-projects/esprima-next/tree/242fb79474f623c0efba35a25fa96ea48e0db35d/src),
the npm 6.0.3 release's recorded `gitHead`. Its compiled release module is
**byte-identical** to the Esprima-next module in the pinned JetStream bundle:
269,506 characters, SHA-256
`f82559a457889044cedb61c0852ac390c8806cc736ead6721ff7e71d6cfda2c6`.
The audit records every original TypeScript file's digest and the complete
JetStream bundle digest. This supplies typed source for the exact bundled
program, without substituting a different parser release.

## Transcription

All 17 original source files remain: the complete parser, scanner, tokenizer,
JSX parser, AST classes, visitor, comment/error handlers, Unicode data and XHTML
entities. Static bundler wiring becomes local imports and exports. Imports have
`.ts` suffixes and type-only imports where Node's native stripping requires them.
Original string-enum values become typed constant maps; numeric const-enum uses
are inlined to their original values, as in the bundled JavaScript.

The original AST classes keep their layouts and algorithm bodies. Declared
metadata fields describe properties attached later without emitting new fields.
Accurate unions and checked readers replace original `any`, assertions and a
suppression; non-null annotations express existing grammar/control-flow
invariants. The typed pattern view describes the original in-place expression
to pattern conversion, including its original field writes and deletes. Visitor
overloads describe the original accepted AST/list shapes, and retain its original
traversal and root identity. Location readers return the original objects.

The complete input strings, options, tokenizer calls, parse calls and returned
counts remain unchanged. `work(n)` repeats that complete operation and observes
all four counts in an unsigned polynomial checksum. The original success
criterion is completion with those counts. Extra full-AST, token and visitor
observations run only through untimed validation exports.

### Descriptor and prototype operations retained

`Parser.validateParam` in `src/parser.ts` (and the pinned bundle's corresponding
method) calls `Object.defineProperty(options.paramSet, key, ...)` with the
original value, enumerable, writable and configurable flags. **One full original
operation makes 2,184 calls**, and the typed operation makes exactly the same
calls: 232 for Backbone, 832 for jQuery, 803 for MooTools and 317 for Underscore.
Tokenization contributes zero calls. These operations remain unchanged as
compiler targets; any nts refusal is a maintainer finding.

An instrumented run of the untouched bundle also records **172
`Object.defineProperty` calls during module initialization**, including Webpack's
export scaffolding; this initialization is outside work. Static export scaffolding
is represented by TypeScript imports/exports in the port. There are **zero
`Object.create` calls during work or original bundle initialization**.
`ErrorHandler.constructError` still contains its original `Object.create(base)`
and `Object.defineProperty(error, "column", ...)` operations; these error-only
paths are dormant on the valid original inputs. `source-audit.json` separates
initialization, each input, the complete original run and the typed run.

## Validation

The untouched pinned bundle ran separately under Node **24.20.0**. Every input
matched the original bytes. Every complete AST and token array matched the
original bundle's JSON serialization byte for byte, including all locations,
ranges, values and node fields. `source-audit.json` records each digest.

Additional untimed fixtures match the original for JSX, templates, regular
expressions, comments, destructuring, rest/default parameters, async/arrow
functions, private fields, static blocks, bigint and optional chaining. Only the
bigint fixture's serialization tags bigint values with their decimal digits.
The retained visitor traverses every original AST and returns the identical
root object for all four inputs.

| Original input | Tokens | Tokens plus top-level statements | Parameter descriptors |
| --- | ---: | ---: | ---: |
| `backbone-1.6.1.js` | 11,316 | 11,317 | 232 |
| `jquery-3.7.1.js` | 44,605 | 44,606 | 832 |
| `mootools-core-1.6.0.js` | 38,365 | 38,429 | 803 |
| `underscore-1.13.7.js` | 10,686 | 10,687 | 317 |

`work(0) = 0`, `work(1) = 381213099`, `work(2) = 214361558`.
The Float64 checksum bits for `work(1)` are `41b6b8d9ab000000`.

Validation commands, using `.tool-versions` and `packageManager`:

```sh
pnpm install
pnpm exec tsc --ignoreConfig --strict --noEmit --skipLibCheck --target es2024 --module nodenext --allowImportingTsExtensions benchmarks/cases/jetstream-esprima-next-wtb/case.ts
node --test benchmarks/jetstream.test.ts
```

The exact shared-test layout reports **9 tests, 9 passed, 0 failed, 0 skipped**.
Strict TypeScript 7.0.2 passes. A syntax-tree audit finds no `any`, type assertion,
`as` cast or type-check suppression in the port. Tests contain no timing checks.

## Timing exception

**Approved complete-operation timing exception: 57.491258 ms at `seed = 1`
under Node 24.20.0.** One is the smallest positive whole-operation count, and the
call still tokenizes and parses all four complete original inputs.

The unchanged `benchmarks/common/bench.mjs` measured five sequential fresh
processes with its own warmup, calibration and five timed trials per process.
The process minima were **70.521097, 90.745845, 59.685240, 57.491258 and
61.925936 ms**. These are local scale observations, not nts measurements.
Maintainers own nts compilation, domains, oracle-count recording and measurement.
