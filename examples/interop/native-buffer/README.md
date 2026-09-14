# Native buffer operations from TypeScript

`src/main.ts` is a native library function. It uppercases ASCII bytes directly
in a C-owned buffer, preserving NUL and non-ASCII bytes. No managed array,
copy, allocation, or memory-management helper is needed by that function.

Build with the current compiler:

```sh
cargo build -p nts-cli
NTS_BIN="$PWD/target/debug/nts" examples/interop/native-buffer/build.sh
```

The build runs a correctness control. To transform a file, use distinct input
and output paths:

```sh
target/interop-native-buffer/caller input.txt output.txt
```

The C driver owns the buffer and handles file I/O and errors. The TS function
borrows the buffer for the call, by a manual contract: `length` must describe
live, writable memory. ResourceFlow does not enforce that contract yet.

This is the first runnable native-operations slice, not a filesystem runtime
rewritten in TS. Native aggregate layout, address-of, typed allocation, and
C callback adapters remain to be designed and implemented. The next example
should move the I/O into TS as those operations become available.

The LLVM native integration test compiles this same TS source through both
backends and runs it against an independently compiled C caller.
