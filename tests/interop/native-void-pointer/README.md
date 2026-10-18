This fixture checks pointer values against a separately compiled C consumer.
The C producer lends static storage; TypeScript neither owns nor frees it.
Both C and LLVM run under NoGC and reference counting.

On landed main `b5f5915b03c5`, `typedToVoid` fails with TS2345. Changing only
`type Input = Ptr<void>` to `type Input = Ptr<Uint8>` compiles and runs the
same consumer on all four backend/provider arms. Returned pointers, nullable
results, and `void **` / `const void **` output slots already pass on main;
they guard the existing representation while the TypeScript surface changes.

`compiler/core/tests/native_scalars.rs` checks the matching type controls:
the permitted direction, constness, handle separation, absence of an element
projection, and exact void selection excluding any, undefined and never.

The consumer also executes a generic void-pointer forwarding instantiation and
bytesFrom on returned const void storage, covering the existing untyped-memory
overload as the pointer surface changes.
