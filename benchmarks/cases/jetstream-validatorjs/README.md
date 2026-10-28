# JetStream 3 validatorjs

This case transcribes the complete `validatorjs` JavaScript workload from
[WebKit/JetStream revision 3967678fa8ab98d847ab33cf3728dba726fa854b](https://github.com/WebKit/JetStream/tree/3967678fa8ab98d847ab33cf3728dba726fa854b/validatorjs).
One iteration runs the original fixture corpus and its **10,114 assertions**.
The port retains all 113 validator library modules present in the bundle's source
map, including sanitizers and helper paths that the default fixtures do not call.

## Sources and licences

The original entry files are `validatorjs/dist/bundle.es6.min.js` and
`validatorjs/benchmark.js`. The unminified bundle and `bundle.es6.js.map` identify
the exact library modules, and `validatorjs/src/test.mjs` supplies the complete
fixture source. The locked library is validator **13.15.15**. Its original ES
module syntax comes from
[validatorjs/validator.js revision 3847c6f90192bf9eec1aabc1bcb33e33d5810881](https://github.com/validatorjs/validator.js/tree/3847c6f90192bf9eec1aabc1bcb33e33d5810881/src),
the commit named by that release tag. This removes generated Babel/CommonJS and
Webpack export transport without importing a package at runtime.

The validator library and fixtures are MIT, copyright 2018 Chris O'Hara and
contributors. The benchmark wrapper is BSD-2-Clause, copyright 2025 Apple Inc.
The referenced UUID expression is also MIT, copyright Robert Kieffer and
contributors. Source notices and revision links are retained in the files; the
suite's shared notice records the complete applicable licences. No additional
data files or runtime dependencies are required.

## Work and validation

`work(n)` repeats **n complete original fixture runs**. `seed = 1` is one full
run; the original JetStream registration uses 120 outer iterations. No string,
regular expression, country or locale table, valid/invalid fixture, or inner
loop is reduced. Each original assertion increments the returned count and
throws on a failed condition. The original final check still requires exactly
10,114 assertions. The numeric checksum folds those successful counts with
`(checksum * 31 + assertionCount) >>> 0`; it returns 10,114 for `n = 1` and
323,648 for `n = 2`.

The timed adapter retains one `Benchmark`, matching the original driver's
lifetime, and resets its scalar result before each work call. `render(n)` uses
a fresh observer instance and returns the count from every full iteration.
Zero iterations fail the original expected-count condition. The source's
`error` fixture groups are retained and remain unexecuted by its original test
helper. Date-dependent fixtures continue to use the current `Date` and default
time zone, as upstream does; production code does not patch the clock or globals.

## TypeScript adaptations

Static `.ts` imports replace generated module export descriptors and the global
bundle export. All original validation functions, regular expressions, tables,
branches, and fixture bodies remain. The source's console assertion transport
becomes a thrown error with the same condition and message.

The library has typed option objects, lookup tables, array elements, and
primitive unions. A typed merge overload describes the original mutation of
an option object with its defaults; its loop is unchanged. Where TypeScript
cannot preserve a parameter's more precise type after merging, a local holds
that same merged object. Explicit `Number` and `String` conversions state the
coercions already required by the original arithmetic, regular-expression
callbacks, property keys, and `parseInt` calls. Named parameters and a typed
rest tuple describe the original legacy arguments.

Checked narrowing replaces unchecked optional values from `pop`, `shift`, or
`match`; missing values still fail with `TypeError`. Existing type-tag tests
serve as predicates. The `isIn` array still uses its original string-keyed
property reads and writes after an explicit object guard. A missing separator
in `isDate` has the original `split(undefined)` result. Optional primitive
properties and the unknown-value string conversion retain the original
successful results and failures. No assertion cast, non-null assertion,
prototype mutation, descriptor reflection, runtime code generation, or Node
service is used by the production code.

The fixture helper keeps its original validator-name lookup. A mapped type ties
each name to its real input and argument tuple. To express that dispatch without
an assertion, 84 omitted argument lists and two explicit `undefined` lists spell
their original empty-array default at the call site. All supplied fixture
values and the order of calls are retained.

## Verification and timing

Strict TypeScript checking covers the entry point, the complete library, and
all fixtures. Independent Node 24.20.0 checks compare every original validator
call, mutated argument, and raw result for `n = 1` and `n = 2`, using the pinned
bundle's unchanged CommonJS module bodies in a separate VM. The untouched
minified bundle and original wrapper also pass their own validation. A fixed
clock is used only in the isolated comparison VMs so date-generated arguments
can be compared exactly. Additional library checks cover the retained
sanitizers, legacy arguments, nonboolean results, and thrown failures.

A structural comparison checks all 113 source modules and the entire fixture
body, allowing only the adaptations listed above. The proposed shared test
checks the seed, both complete-run checksums, returned counts, and the original
zero-iteration failure.

## Timing

Timing: **8.994483625 ms at seed = 1 under Node 24.20.0**, within the 1–10 ms target.

The unchanged suite harness warms and calibrates inside Node and takes the best of five trials. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `40c3c10000000000`. Maintainers compile with nts, record oracle counts and measure their own machines.
