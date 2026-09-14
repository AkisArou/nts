# A bounded read through `void *`

TypeScript owns a fixed local byte buffer, hands its address to libc's `read`,
and reads the bytes back out. The buffer never becomes a managed array and is
never copied.

```ts
const buf = local<c_uint8>(CAPACITY);
const got = read(fd as Fd, buf, max as Count);
```

## What this example is for

`read` takes `void *`, and that is the point. `Ptr<c_uint8>` converts to
`Ptr<unknown>` because TypeScript's own variance says every `Ptr<T>` is a
`Ptr<unknown>` — which is exactly the conversion C performs at the call. The
reverse does not typecheck, and that is the direction mistakes live in: turning
an address of unstated type back into a typed pointer is a claim nobody checked.

`void` has no element type, so `p[i]` on a `Ptr<unknown>` is refused. A `void *`
is an address to hand onward, not storage this program may read through.

## The witness

`native/witness.c` includes the real `<unistd.h>` and then the generated
`native_witness.c`. That is the check, and it is not decoration.

A binding declaring the buffer as `uint8_t *` typechecks, lowers without one
diagnostic, and produces a `program.c` that compiles — because `program.c`
declares `read` itself and never sees `<unistd.h>`. It is wrong, and nothing in
that path says so. The witness translation unit does see the system header, and
refuses:

    error: conflicting types for 'read'

That arm is checked in `compiler/codegen/llvm/tests/native.rs` rather than
described here, and it is checked to *fail*: if the typed-buffer binding ever
compiles, the witness has stopped checking prototypes.

`ssize_t` and `ptrdiff_t` are the same type on this target, so `c_ptrdiff_t` is
accepted for `read`'s result. The witness establishes ABI identity, not that the
binding names the same typedef the header does.

## The caller

`native/caller.c` drives a pipe, so what the descriptor contains is this file's
own fact:

| arm | checks |
|---|---|
| five bytes written | the count comes back as five |
| the same bytes summed | the buffer holds them — a count alone cannot tell a filled buffer from an untouched one |
| empty payload, write end closed | end of file is `0` and is not an error |
| a closed descriptor | the negative outcome travels the same path |
| a request above capacity | TS's own guard refuses before `read` is reached |

## Building

    sh examples/interop/native-fd/build.sh

Both backends compile and run this in the test suite, under the no-GC and
reference-counting providers.
