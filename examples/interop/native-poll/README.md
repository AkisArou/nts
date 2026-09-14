# Poll a real pipe from TypeScript

```sh
cargo build -p nts-cli
NTS_BIN="$PWD/target/debug/nts" examples/interop/native-poll/build.sh
```

C creates a pipe. TypeScript creates the native request storage and calls libc's
`poll` in three ways:

- `waitReadable`: one zero-initialized local `PollFd`.
- `waitPair`: a fixed local array of two `PollFd` elements.
- `waitReadableHeap`: typed `malloc<PollFd>(sizeof<PollFd>())`, with a null check
  and `free` in `finally`.

The caller checks an empty pipe, a pipe with a byte ready, and the same pipe after
draining it. The pair test checks each array position independently. TS reads an
address taken before `poll` to observe the resulting event.

`types/poll.d.ts` is a hand-written Linux LP64 binding. Its `@ntsNoEscape fds`
annotation states that libc borrows the array synchronously without retaining
its address. The compiler proves the corresponding contract for the TS helper
from its body. It rejects local addresses that escape or enter suspension.

`native/layout.c` independently includes the platform's `<poll.h>` and reports
size, alignment, and every field offset. The caller compares them with the
generated layout. These are separate translation units: including two definitions
of `struct pollfd` in one translation unit is not supported.

Expected output:

```text
native poll: local, fixed array, heap; idle, readable, drained; layout agrees
```

The LLVM integration tests run these same files against C and LLVM output with
both no-GC and reference counting. Native storage has no runtime header and is
not traced. Heap ownership and bounds remain manual; this example does not
implement callbacks, asynchronous I/O, or ResourceFlow.
