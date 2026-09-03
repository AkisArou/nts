# 0064 — Where the data began

`elementwise` was 1.25x C++ with no reason written down. It is **0.81x** now,
and the change is eight bytes.

## Everything about the loop was already right

The case exists to measure whether an elementwise map vectorizes, and its own
header says what it is watching for: a counter left as a double makes every
index an `fptoui` of a floating-point induction variable, which LLVM's scalar
evolution cannot model, so nothing packs.

That is not what was wrong. We vectorize — four `mulpd` against the C++'s two,
because the guard clone puts two copies of the loop in the binary. The bounds
check is gone, `bounds` having proved it. The element pointer is hoisted into a
register. And the loop body is instruction-for-instruction what clang emits for
`std::vector`:

```text
movupd (%rsi,%r9,1),%xmm2        movupd (%rax,%r11,1),%xmm2
movupd 0x10(%rsi,%r9,1),%xmm3    movupd 0x10(%rax,%r11,1),%xmm3
mulpd  %xmm0,%xmm2               mulpd  %xmm1,%xmm2
mulpd  %xmm0,%xmm3               mulpd  %xmm1,%xmm3
movupd %xmm2,(%rsi,%r9,1)        movupd %xmm2,(%rax,%r11,1)
movupd %xmm3,0x10(%rsi,%r9,1)    movupd %xmm3,0x10(%rax,%r11,1)
```

Same instructions, same order, 25% apart. What is left when the code is
identical is the data.

## `sizeof(NtsArray)` was 40

An array that nothing has grown keeps its elements inline, immediately after the
struct — `array->elements = (unsigned char *)array + sizeof(NtsArray)`. Both
providers hand back 16-byte aligned blocks. So `sizeof(NtsArray) % 16` *is* the
alignment of every inline element block, and it was **8**.

Every 16-byte SSE access on a `double[]` therefore straddled a 16-byte boundary.
`movupd` is free when it does not cross one and is not when it does, and this
crossed on every load and every store, 524,288 times per run.

Padding the struct to 48:

```text
before   192.13us C   192.41us LLVM   1.25x C++   0.21x node
after    129.35us C   124.22us LLVM   0.81x C++   0.14x node
```

Eight bytes per array, once, against every SSE access its elements will ever
take. `arrays` and `array-methods` are unchanged; the memory suite is at its
floors.

## What this says about the other rows

Four AWFY rows and this one sat between 1.23x and 1.35x with nothing written
about any of them, and the assumption was that each had its own story. This one
had nothing to do with code generation at all, and it was found by running out
of things that could differ.

## The second instance, which is not worth it

A string's units are inline too, at `(unsigned char *)s + sizeof(NtsHeader)`,
and `sizeof(NtsHeader)` is 24 — so every string's data starts 8 bytes past a
boundary for exactly the same reason. The obvious move is to pad the header to
32 and take the same win on every string row.

Tried, and it does not pay. Three things came out of it:

The new `_Static_assert` caught the first problem immediately: a 32-byte header
makes `NtsArray` 56, which is 8 mod 16 again, so the array would have quietly
lost what it just gained. That is the assertion earning its place on the day it
was written.

The second is that `NtsHeader`'s size is not a runtime detail. Generated C
brace-initializes a string literal's header, so an added field is
`-Wmissing-field-initializers`; and both backends' layout arithmetic has 24 in
it, so `elementwise` **segfaulted**. Changing it is a project across
`nts_codegen_common::layout` and two emitters, not eight bytes.

The third is the number. `bytes` was the one row that still built and ran, and
it came out at 433.46us against 433.43us committed — unchanged. Whatever a
string's alignment costs, it is not what that row is paying, and eight bytes on
every object in the program is a poor trade for it.

So: named, measured, and declined. A row that wants it can reopen it with a
number.
