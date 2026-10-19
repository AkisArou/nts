# Legacy decorators (`experimentalDecorators`)

**Why node cannot be the oracle:** node's transform has no
`experimentalDecorators` mode, and V8 does not parse decorators at all.

**The oracle these need:** tsgo's emit with `experimentalDecorators: true`
(any target; checked at `ESNext`, so `useDefineForClassFields` is on, which
`property-decorator-and-define-semantics.ts` depends on). Not
`emitDecoratorMetadata`: that emit calls `Reflect.metadata`, which needs a
polyfill library no case here may import.
