# Decorators (TC39, stage 3)

This family waits for enrollment with standard decorator emit. The oracle's
pinned runtime target lets TypeScript emit `__esDecorate` and
`__runInitializers`, and Node runs the result. `experimentalDecorators` stays
off: these cases use standard decorators, while the legacy family needs that
option enabled.

`metadata.ts` and `shared-inherited-metadata.ts` install `Symbol.metadata`
when the runtime lacks it, preserving the program's own runtime setup.
