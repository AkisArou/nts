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
    declare module "c:sys/utsname" {

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

## Where the definition comes from

`program.h` and `program.c` **include `<sys/utsname.h>`** rather than defining
their own `struct utsname`. That is why `native/caller.c` can include both the
real header and the generated one; while nts defined its own copy, a
translation unit holding both got `redefinition of 'struct utsname'` and the
two could never meet.

It also moves the check. The `_Static_assert`s in `program.c` used to compare
nts against nts -- both sides computed from one field list, so they checked the
arithmetic and nothing else. Against the included header they are the C
compiler answering about the real type:

| change to the binding | program.c | native_witness.c |
|---|---|---|
| one member length 64 | refused | refused |
| sixth member dropped | refused | refused |
| `_GNU_SOURCE` removed | refused | refused |

The witness still carries what `program.c` cannot: each member's exact type,
and the prototype re-declared beside the real one.

`_GNU_SOURCE` is defined at the top of `program.c`, which nts owns to the first
line. `program.h` cannot do that -- an includer that reached for `<stdio.h>`
first has already fixed what `struct utsname` is -- so it *requires* the macro
and stops the build with a message naming the flag.

## Build

    sh examples/interop/native-uname/build.sh
