# Generated runtime typecheck

Native TypeScript 7.0.2 is the authoritative semantic gate for the generated
React runtime. The final JavaScript TypeScript 6 API remains a tool-only
dependency because normalization and React Compiler recovery use
`createProgram`, checker types and AST traversal that the native package does
not expose in process.

All three generated trees contain 123 TypeScript files and pass the strict
native checker:

| Stage | Diagnostics |
| --- | ---: |
| normalized | 0 |
| profile-specialized | 0 |
| linked | 0 |

The profile pass replaces 571 build-constant references and folds 501 `if`
statements. The link pass now discovers exported primitive `const` values in
every module, retains imports and evaluation, replaces 2,448 imported reads,
and folds 610 more `if` statements. This generalized rule includes feature
flags and numeric lane constants without naming React-specific source sites.

`tools/runtime-escape-audit.mjs` separately scans all 369 generated files. It
finds zero `any` keywords, TypeScript suppression directives, or nested type
assertions. The remaining 449 normalized `unknown` occurrences are intentional
checked heterogeneous boundaries or values awaiting a concrete projection;
they do not grant dynamic JavaScript operations.

The converter handles recurring Flow shapes mechanically. Source-specific type
facts live in `overrides/manifest.json`, where the exact upstream SHA-256 guards
every affected file. Regeneration still proves runtime-syntax equivalence for
all 122 upstream inputs; the generated HostConfig is the additional 123rd
module.

Passing this gate means the React input is ordinary strict TypeScript. It does
not mean NTS can represent every accepted type or lowering construct. Those
results are measured independently in `runtime-native-probe.md` and reduced in
the blocker fixtures.
