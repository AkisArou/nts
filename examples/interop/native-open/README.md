# native-open

POSIX `open`, which is variadic -- and not decoratively so.

    int open(const char *pathname, int flags, ...);

With `O_CREAT` the third argument is required and names the new file's
permissions; without it, passing one is undefined. One C declaration covers
both, so a compiler that cannot describe `...` cannot reach `open` at all.

A TypeScript rest parameter says the same thing and needs no tag:

    export function open(path: ConstPtr<c_char>, flags: Flags, ...mode: Mode[]): Fd;

The element type is this binding's claim about what it passes, which C's
prototype has no place to record -- it constrains nothing after the comma. So
the checking happens in the declaration, where it can be read, instead of
nowhere. A library needing two shapes of `ioctl` declares two names for it.

## The tail is arguments, not an array

A TypeScript rest parameter is normally *gathered*: `f(1, 2)` builds an array
and passes one value. The first version of this did exactly that to `open` --

    v4 = nts_array_new(&nts_desc_double, 0.0);
    v13 = (uint32_t)v4;
    v5 = open(v1, v12, v13);

-- handing C the address of an empty `NtsArray` cast to `uint32_t`. It
compiled, it linked, and it was wrong. A native variadic call lowers its
arguments without gathering, and each one takes the tail's declared type.

## What C promotes, a binding may not name

C applies the default argument promotions to everything past the last declared
parameter: anything with integer rank below `int` becomes `int`, and a `float`
becomes a `double`. A declaration naming one of those describes an argument
nobody passes, so it is refused with the promoted type named:

    foreign function `open` variadic tail is `uint16_t`, which C promotes to
    `int` before the callee sees it; declare `int`

`mode_t` is `unsigned int` here, which is why the binding says `c_uint32`.

## What checks it

`native/caller.c` asserts the flag and mode constants against the real macros,
then checks the file the compiled TypeScript created.

    createAndWrite = 1
    mode = 0600
    native open: one variadic prototype, two arities

**The permission bits are the check, not the contents.** A call that dropped
the third argument still creates the file, with whatever was in the register --
tried, and it came out `01650`. Reading the byte back would have passed.

Both backends run this caller. `native_witness.c` re-declares the prototype
beside the real `<fcntl.h>`:

    extern int open(const char *, int, ...);

and the LLVM lane spells the function type at each call, which a variadic call
must:

    declare i32 @open(ptr, i32, ...)
      %v5 = call i32 (ptr, i32, ...) @open(ptr %v2, i32 %v21, i32 %v22)
      %v3 = call i32 (ptr, i32, ...) @open(ptr %v1, i32 %v10)

## One more binding the witness refused

This example's `write` was first declared `(Fd, ConstPtr<unknown>, c_uint32):
c_int`. It typechecks, it lowers clean, and it is two different types from what
`<unistd.h>` declares. The witness said `conflicting types for 'write'`, which
is the entire reason the prototype is re-declared beside the real one. It is
`c_size_t` and `c_ptrdiff_t` now.

## Build

    sh examples/interop/native-open/build.sh
