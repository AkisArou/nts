# Decorators (TC39, stage 3)

**Why node cannot be the oracle:** node v24's V8 does not parse decorators
(`SyntaxError: Invalid or unexpected token` at the first `@`), and
`--experimental-transform-types` leaves them in place.

**The oracle these need:** TypeScript's emit with `target: "ES2022"` (or lower),
which downlevels decorators through `__esDecorate` and `__runInitializers`.
With `target: "ESNext"` TypeScript emits the decorators as written, which node
cannot run either. No `experimentalDecorators`: these are the standard
decorators.

`metadata.ts` and `shared-inherited-metadata.ts` install `Symbol.metadata`
when the runtime lacks it, as TypeScript's 5.2 release notes say a program
must; node v24 lacks it.
