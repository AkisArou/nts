# React Compiler output probe

`Counter.tsx` is deliberately small but exercises the two compiler/runtime
boundaries that matter to NTS: React Compiler synthesizes an unannotated
component parameter and a constant-size heterogeneous memo cache.

`npm run compiler:probe` compiles it with the React Compiler bundle built from
the pinned upstream checkout. It then prototypes a mechanical recovery pass:

1. recover component and outlined callback parameter types from preserved
   source byte ranges;
2. annotate compiler-created evolving locals from their reaching assignments;
3. ask a preliminary TypeScript program for the types written to each cache
   slot; and
4. specialize `_c<N>` with a concrete tuple type and run a final strict check
   where `_c` has no `any` in its contract.

The generated source is ignored. Counts, hashes, inferred slot types and final
diagnostics are recorded in `reports/compiler-output-probe.json`.
The unmodified checked TSX reaches the separately recorded JSX refusal.
`nts/tsconfig.json` instead feeds the probe's post-JSX output to NTS. The
recovery pass gives React Compiler's evolving locals explicit types, so NTS
lowers the full component, closure and cache control flow.

For backend inspection, the probe also emits a disposable version with one
fixture-specific automatic JSX lowering. `npm run compiler:native` shows that
its cache becomes direct typed fields in HIR and records the remaining backend
ABI gaps without presenting that JSX transform as the production frontend.
