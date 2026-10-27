# TypeScript cases waiting for an oracle

Cases in the same format as `tests/typescript/` (test262 front matter,
self-checking through the harness's `assert`) for concepts the suite's
oracle, node's `--experimental-transform-types`, cannot judge. The runner
does not select this directory. The suite will take them when TypeScript's
emit, run by node, is an oracle; each family's README says which compiler
options that emit needs.

Every case here was checked before the switch, on 2026-10-20 that way: type-checked and
emitted by tsgo 7.0.2 with the family's options, the emit run by node
v24.20.0 with the harness installed, and passing.

| family | cases | why node cannot be the oracle |
| --- | ---: | --- |
| `decorators/` | 12 | node's V8 does not parse decorators; TypeScript must downlevel them (`target: ES2022`) |
| `legacy-decorators/` | 8 | `experimentalDecorators`, which node's transform does not implement |
| `accessor-fields/` | 6 | node's V8 does not parse `accessor`; TypeScript must downlevel it (`target: ES2022`) |
| `transform-divergence/` | 5 | node's transform answers differently from TypeScript's emit (it throws ReferenceError) |
| `modules/` | 10 | each needs fixture modules beside it; one case touches TypeScript's import elision, which node's stripping cannot do |
| `commonjs-interop/` | 5 | `import x = require()` and `export =` need a CommonJS project and a second module |
| `jsx/` | 6 | `.tsx`, which node's type stripping does not accept |
