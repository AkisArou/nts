# Module cycles and React build ordering

## Reproduction

```sh
npm run --prefix runtime/react blockers:probe
```

The fixture contains a real top-level cyclic read. NTS emits `NTS1004`, and a
native ESM execution would likewise throw in the temporal dead zone. This is a
correct diagnostic and establishes what must not be suppressed.

The generalized link pass now propagates exported primitive `const` values
without deleting their imports or module evaluation. This is semantics
preserving for numbers, strings, booleans and null, improves code generation,
and removed 23 cycle diagnostics from the full profile, including lane
constants. The remaining diagnostics involve `ReactSharedInternals` at module
assignment and `firstScheduledRoot` reads inside installed callbacks. They need
a value-edge comparison with upstream's bundled module order; only proven late
reads or false type-only edges belong to an NTS module-graph fix. A genuine
top-level TDZ must remain a refusal.
