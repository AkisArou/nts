# Poll a real pipe from TypeScript

```sh
cargo build -p nts-cli
NTS_BIN="$PWD/target/debug/nts" examples/interop/native-poll/build.sh
```

The C caller creates a pipe and owns an ordinary `struct pollfd`. TypeScript
sets its events, takes `addrOf(request, "revents")`, calls libc's `poll`, and
reads the resulting event through that address. The test checks an empty pipe,
a pipe with a byte ready, and the same pipe after draining it.

`types/poll.d.ts` is a hand-written Linux LP64 binding. `native/layout.c`
independently includes the platform's `<poll.h>` and reports size, alignment,
and every field offset. The caller compares them with the generated layout.
These are separate translation units: including two definitions of `struct
pollfd` in one translation unit is not supported.

Expected output:

```text
native poll: idle, readable, drained; platform layout agrees
```

The LLVM native integration tests run the same files against C and LLVM output,
with both no-GC and reference-counted runtime policies. Native payloads contain
no runtime header. Storage lifetime is manual; this example does not implement
allocation, callbacks, asynchronous I/O, or ResourceFlow.
