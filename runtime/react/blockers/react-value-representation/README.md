# React value representation

## Reproduction

```sh
npm run --prefix runtime/react blockers:probe
```

The strict fixture models the two hottest heterogeneous React boundaries: an
element key (`string | unique symbol | null`) and the recursive React node
union. Native TypeScript 7.0.2 accepts both. The current NTS HIR probe refuses
the key field and the recursive node parameter.

In the full production runtime, 520 diagnostics are direct key property or
union-member accesses. Another seven function parameters and one key-map
parameter carry the same representation. Twenty-four diagnostics carry a
React node through a field or parameter. These repetitions do not represent
hundreds of unrelated missing features.

## Required representation

NTS already documents `unknown`, unions and optional values as a 16-byte tagged
value. React needs that representation to reach a fixed point for recursive
unions and to include unique-symbol tags. A key or node value is packed at the
heterogeneous storage boundary, then narrowed by its tag before inspection.
Inline number, boolean and symbol payloads must not allocate a box.

This is the baseline correctness layout. Once a component is known, NTS can
monomorphize its props, reducer state and update queue, and keep only the Fiber
or element boundary erased. A generic `Hook<State>` cannot by itself make the
shared hook list homogeneous: consecutive hooks may store unrelated state,
effects and cache records. Specialization must therefore produce a typed
component frame while retaining a checked fallback compatible with upstream
hook ordering, interruption and hot reload.
