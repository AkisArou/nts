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

## The binding is derived, not written

`types/poll.d.ts` is **generated from `<poll.h>`**, by `bind.sh`:

    sh examples/interop/native-poll/bind.sh

The struct, its members and the prototype all come from the header, read by the
same clang the witness compares against. It replaced a hand-written file, and
the two are the same binding -- identical types and identical contract,
differing only in a parameter *name*, which the generated one takes from the
header (`nfds`) where the author had chosen `count`.

That equality is the interesting part, because the hand-written file carried
this reasoning:

> `events` and `revents` are `short`, and a binding calling them `int` has the
> right size and the wrong struct.

True, load-bearing, and now something a tool reads rather than something a
person has to remember. `c_int16` is what the generator emits because that is
what the header says.

**One thing the header does not state, and the tool will not invent.**
`@ntsNoEscape fds` says libc reads the array during the call and keeps no
address into it. A C signature cannot express that -- `const` restricts writing
through a pointer, not retaining it -- so it comes from `--no-escape poll:fds`
in `bind.sh`, where an author put it. Without it the compiler refuses
`local<PollFd>()` as an escape, which is correct and is what makes the flag a
claim rather than a formality.

`native/layout.c` independently includes the platform's `<poll.h>` and reports
size, alignment, and every field offset for the caller to compare. Since
`program.h` now includes what the binding names rather than defining its own
`struct pollfd`, the two definitions no longer collide -- but the file stays a
separate translation unit, because a *runtime* report and a compile-time
assertion answer different questions.

Expected output:

```text
native poll: local, fixed array, heap; idle, readable, drained; layout agrees
```

The LLVM integration tests run these same files against C and LLVM output with
both no-GC and reference counting. Native storage has no runtime header and is
not traced. Heap ownership and bounds remain manual; this example does not
implement callbacks, asynchronous I/O, or ResourceFlow.
