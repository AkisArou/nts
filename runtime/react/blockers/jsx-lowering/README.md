# JSX lowering

## Reproduction

```sh
cargo run -q -p nts-cli -- hir \
  runtime/react/blockers/jsx-lowering/repro/tsconfig.json
```

At the compiler state recorded in `../../upstream.lock.json`, the frontend
accepts and types the TSX but HIR reports `NTS1001 a jsx self closing element is
not supported by this lowering yet`. The exported `Button` body is therefore
absent after pruning.

## Required interface

JSX lowering should target the configured JSX runtime (`jsx`, `jsxs`, and
`Fragment`) using ordinary typed calls. React Compiler runs before this step
and deliberately leaves JSX in its output. The lowerer must preserve:

- intrinsic names versus component values;
- key as React element identity metadata rather than a normal prop;
- ref values and the distinction between an omitted prop and `undefined`;
- child order, text children, spreads, fragments and development source data;
- the checker-provided `JSX.Element` result type.

The lowering itself should allocate no intermediate dynamic property map when
the intrinsic element and its props are statically known. A renderer adapter
can then specialize a known native element's prop record and pack only values
that cross the heterogeneous React element boundary.
