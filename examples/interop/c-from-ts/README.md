# TypeScript calling C

A small C library with scalar arguments and a nullable opaque `Counter *`.
The library owns its representation; TypeScript receives the handle and passes
it back. Destruction is explicit.

```sh
cargo build --release -p nts-cli
./examples/interop/c-from-ts/build.sh
```

Expected output:

```text
scalar conversions, opaque handles, null, and cleanup: OK
```

The declarations are hand-written ambient modules. The project includes the
shipped `runtime/native/libc.d.ts`; no `paths` mapping is needed. `Counter` is
`Opaque<"Counter">` from `c:types`, naming the C struct tag. It has no TypeScript
fields and no managed header. `Counter | null` represents a nullable pointer.

`clamped(n: c_int)` takes C's `int`: the generated header declares it
`double clamped(int32_t)`, so a C caller converts its argument as C converts
any (`clamped((int32_t)3.75)` is `clamped(3)`), and the TypeScript body reads a
whole number in `int`'s range. It passes `n` to C and adds `0.25` to the
result using ordinary TypeScript arithmetic. `roundTrip` creates a counter, changes it,
reads it, and destroys it. A negative initial value exercises the null branch.
The C caller checks the library's live-handle count after both calls. The build
compiles the C library separately and checks generated prototypes against its
header. Set `NTS_BIN` or `CC` to use a different compiler binary.

C and LLVM support the handle ABI. Ownership checking, raw C callbacks, pointer
dereferencing, and opaque handles inside runtime containers are outside this
milestone. A handle captured by a closure remains a raw pointer: its C owner must
keep it alive until the last use. No automatic destructor or retain is implied.
