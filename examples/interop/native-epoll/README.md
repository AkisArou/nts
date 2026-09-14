# native-epoll

Linux `epoll`, which is three C shapes at once in twelve bytes.

    union epoll_data { void *ptr; int fd; uint32_t u32; uint64_t u64; };
    struct epoll_event { uint32_t events; epoll_data_t data; } __attribute__((packed));

- a **union**, whose four members share one address
- a **packed** struct, so `data` sits at offset 4 and the whole is 12 bytes
- a **64-bit** member, `u64`, which is `bigint`-branded on this target

Get any one of them wrong and you have a struct of the right kind and the wrong
size. An array of them then puts every element after the first at an address
the kernel does not agree with.

    export type EpollData = Union<{ ptr: Ptr<unknown>; fd: c_int; u32: c_uint32; u64: c_uint64 }, "epoll_data">;
    export type EpollEvent = Packed<Struct<{ events: Events; data: EpollData }, "epoll_event">>;

`Packed<T>` composes rather than taking a third argument, so everything that
reads a struct keeps reading one. It has to be declared because it cannot be
seen: a packed and an unpacked declaration of the same members are the same
text and different layouts.

## What checks it

`native/caller.c` creates a pipe, hands the read end to the compiled
TypeScript, and the descriptor comes back out of the kernel's copy of the
struct -- so the subscription was written where the kernel reads it. It also
prints the real layout, from `<sys/epoll.h>`:

    epoll_event: size=12 align=1 data at 4; epoll_data: size=8
    waitForOne(3) = 3
    aliasedLowHalf(42) = 42

`program.c` and `native_witness.c` both include the real header, so every
number above is asserted against it rather than against this repo. Both are
compiled with `-Wall -Wextra -Werror`, which is not usual for generated code
here and is the point: see below.

These changes to the binding were each tried, and each refused:

| change | what refuses it |
|---|---|
| `Union` written as `Struct` | size 16, not 8 |
| union declared with two of its four members | size 4, not 8 |
| `Packed<...>` removed | size 16 and `data` at 8 |
| a fifth member added | size and every later offset |

## Taking the address of a packed member

`&p->events` on a packed struct is `taking address of packed member` -- a
correctness warning, not a style one, because the result has the member's type
and not its alignment. The compiler never takes one:

    typedef uint32_t NtsUnaligned_uint32_t __attribute__((aligned(1)));
    v8 = (NtsUnaligned_uint32_t *)((char *)v7 + 0);

The offset is one `program.c` already asserts against the C compiler, and the
pointer's own type is what says the address may be any address. That fact rides
on the *type* rather than on the field-address operation, because the operation
is not where it is spent: the load happens through the pointer value one op
later, and a backend reading only that value could not tell. The LLVM side
spells the same fact as `align 1` on the access, which is otherwise the ABI
alignment of the type -- 8 for a member that lives at offset 4.

`-Werror` on the generated program is how this stays true. The warning is the
only thing that reports it, so a build that tolerates warnings cannot tell.

## Two things a binding cannot name

`EPOLL_CTL_ADD` is a macro and `EPOLLIN` an enumerator. Neither is a
declaration, so no binding can carry either -- and the values are **read out of
the header** rather than typed here:

    sh examples/interop/native-epoll/bind.sh      # regenerates src/constants.ts

`native/caller.c` still asserts both against the real ones, and what that
checks has changed: not that someone copied two numbers correctly, but that the
generated file is current. Verified by making it stale -- `READABLE = 4` -- and
watching the caller abort.

`READABLE` rather than `EPOLLIN`, and the two halves of that are not the same
problem:

- **the macro** would have replaced the program's own identifier before the
  compiler saw it, giving `static int32_t 1 = ...`. nts releases each of its
  own names from whatever macro a header bound it to, so this one is handled.
- **the enumerator** is a real declaration, and nothing can release that. A
  program including `<sys/epoll.h>` cannot also define `EPOLLIN`, exactly as
  any C file could not. `nts bind-c` refuses that name rather than generating
  it, and names the flag that fixes it.

## Build

    sh examples/interop/native-epoll/build.sh
