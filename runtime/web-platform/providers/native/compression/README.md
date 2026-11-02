# Native compression capability

`NativeCompressionProvider` supplies the shared `CompressionProvider` contract
with the compiler's bundled Brotli and zlib libraries. Add `bindings.d.ts` to the
project's TypeScript inputs and supply the provider through
`WebPlatformOptions.compression`. The provider's package config contributes its
C source; the called bindings select the bundled libraries and their notices.

Each context owns an opaque managed box. Explicit close is prompt and
idempotent; its finalizer also destroys codec state if a caller abandons it.
There is no global handle registry or numeric pointer. Calls borrow their input
only until return, drain native output in bounded chunks and transfer fresh
views and buffers. The per-call output limit is enforced while producing bytes,
with at most one extra byte probed to distinguish an exact fit from overflow.

All failures cross as values. Incomplete finish preserves the valid output;
other failures discard that call's output and permit only close. Decompression
stops at the first stream end and reports its consumed length, leaving trailing
input for shared policy to reject after delivering valid output. Framing,
checksums, dictionaries and codec algorithms remain in the native libraries.

The implementation targets C and LLVM. The JVM needs its own native capability
binding; these C functions do not become JDK implementations.
