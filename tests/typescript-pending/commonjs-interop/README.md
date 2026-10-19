# CommonJS: `import x = require()` and `export =`

**Why node cannot be the oracle:** the suite's project is
`module: "ESNext"`, where TypeScript rejects both forms (TS1202, TS1203),
and each needs a second module, the `*_FIXTURE.ts` file it names, which the
one-file oracle cannot place. (Node's transform does accept both in a
CommonJS file; the project and the second module are what is missing.)

**The oracle these need:** tsgo's emit with `module: "nodenext"`,
`moduleResolution: "nodenext"`, a `package.json` saying
`"type": "commonjs"`, and every `*_FIXTURE.ts` of this directory beside the
case. tsgo 7 treats a CommonJS-format file with no imports as a module
unless `moduleDetection` is `"legacy"`, and the harness must be a global
script, so they were checked with `moduleDetection: "legacy"` and the
emitted harness preloaded with its entries on `globalThis`.
