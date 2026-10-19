# Programs of several modules

**Why node cannot be the oracle:** the suite's oracle and its materialiser
place one file. Each case here imports `*_FIXTURE.ts` modules from its own
directory, so it needs them laid out beside it, and the runner's fixture
support is test262's `_FIXTURE.js` only. Two cases also test TypeScript's
import elision (`type-only-import-is-elided.ts`, `import-type-is-not-evaluated.ts`):
a plain import used only as a type is removed by TypeScript's emit, and
node's type stripping, which cannot know a name is only a type, would keep
it and fail to link.

**The oracle these need:** tsgo's emit with `module: "ESNext"`,
`moduleResolution: "bundler"`, `isolatedModules` and `verbatimModuleSyntax`
off; the case is `src/main.ts` and every `*_FIXTURE.ts` file of this
directory is beside it. Imports name fixtures by their `.js` path, as
TypeScript's ES module output requires, so the emit runs as written. The
harness must be global for an ES module: it was checked by preloading the
emitted `harness.js` with its entries assigned to `globalThis`.
`dynamic-import.ts` is also `flags: [async]`.
