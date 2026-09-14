# native-uname

POSIX `uname` filling a struct of six fixed arrays stored inline.

`struct utsname` is 390 bytes of `char[65]`, and nothing about it is reachable
without inline arrays: there is no pointer to follow, the members *are* the
storage. TypeScript declares one as `CArray<c_char, 65>`, reads it with
`buf.sysname[n]`, and gets what C's decay gives -- a pointer to the first
element.

    sysname: CArray<c_char, 65>;

## What checks it

`native/caller.c` calls `uname` itself, through the real `<sys/utsname.h>`, and
asserts that the length TypeScript counted is the length `strlen` reports.
Both numbers come from the platform; neither is a constant in this repo.

`native_witness.c` is generated beside `program.c` and compiled on its own. It
includes `<sys/utsname.h>` because **the binding names it**:

    /**
     * @ntsHeader sys/utsname.h
     * @ntsDefine _GNU_SOURCE
     */
    declare module "c:utsname" {

Both lines are load-bearing, and the second is the one worth keeping. glibc
calls the sixth member `domainname` under `__USE_GNU` and `__domainname`
without it, so the same header yields two different structs and the binding is
written against exactly one of them.

These five sabotages of the binding were each tried, and each refused:

| change | what refuses it |
|---|---|
| `@ntsDefine _GNU_SOURCE` removed | no member named `domainname` |
| one member `c_uint8`, not `c_char` | the `_Generic` type assert |
| one member `CArray<c_char, 64>` | the size and every later offset |
| sixth member deleted | the size |
| `@ntsHeader stdio.h` | `struct utsname` is not defined |

The second is the one a layout-only check misses. `uint8_t` is `unsigned char`,
which has `char`'s size, `char`'s alignment and `char`'s offsets -- and is a
different type, which is why the witness asserts each member's type and not
only where it sits. The first version of this binding said `c_uint8`.

## A limitation this example runs into

`native/caller.c` does **not** include the generated `program.h`, because it
cannot: that header *defines* `struct utsname` instead of including the header
that declares it, so a translation unit holding both is a redefinition error.
The two exports are declared by hand there instead.

The fix is for `program.h` to include what the binding names, which is now
possible -- `@ntsHeader` is exactly that information. It needs per-struct
provenance first: the program knows the set of headers it declares, not which
header covers which struct, and skipping a definition no header supplies would
turn a working build into an undefined tag.

## Build

    sh examples/interop/native-uname/build.sh
