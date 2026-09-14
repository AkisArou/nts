# Native operations: example-led semantics

This is the working revision of the native-operations part of
[native-values-and-resource-flow.md](native-values-and-resource-flow.md).
That document remains design history; its proposed API is not a fixed contract.
ResourceFlow follows native operations and is not implemented by this slice.

## First executable slice: a caller-owned buffer

[The runnable example](../examples/interop/native-buffer/src/main.ts) exposes:

```ts
import type { Ptr, c_uint8 } from "c:types";

export function uppercaseAscii(bytes: Ptr<c_uint8>, length: number): number {
  let changed = 0;
  for (let i = 0; i < length; i++) {
    const byte = bytes[i];
    if (byte >= 97 && byte <= 122) {
      bytes[i] = byte - 32;
      changed++;
    }
  }
  return changed;
}
```

The C driver owns an ordinary byte buffer and can stream a file through this
function. File I/O remains in C in this example. Its purpose is to establish
native storage access before choosing the aggregate and allocation APIs.

## Shared memory semantics

- `Ptr<T>` is a native address whose element layout is `T`. The existing
  `c_*` scalar brands select the C spelling, signedness, and element width.
  `Opaque<"Tag">` remains an address to a foreign struct whose layout is not
  available. It permits passing the handle but does not permit dereferencing.
  Both use the same compiler pointer representation with different pointees.
- `p[i]` indexes elements, not bytes. Reads project native scalars into TS
  `number`. Writes convert a TS number into the declared element representation.
  Arithmetic remains ordinary number arithmetic, including for 64-bit integer
  elements: this API does **not** promise exact arbitrary `int64_t`/`uint64_t`
  arithmetic. An exact-integer API needs a separate decision before it ships.
- Finite fractional writes to integers truncate toward zero. The truncated
  value must fit the destination type. Float32 writes round to float32. This
  first API does not define wrapping integer stores or saturation.
- Indices must be finite integers representable as signed 64-bit offsets on the
  currently supported native targets. The complete access must designate live,
  correctly aligned, initialized storage for reads, and writable storage for
  writes. These are caller obligations; there is no bounds or lifetime check.
  Negative indices are valid only when they still designate an element of the
  same allocation. Invalid accesses and out-of-range integer conversions have
  no portable behavior promised by this slice.
- `const alias = p` copies the address. It does not copy the elements, transfer
  ownership, retain the pointee, or free anything. Aliases may observe each
  other's writes, including writes performed inside foreign calls.
- Compound assignments and increments use the existing TS assignment lowering:
  the receiver and index are evaluated once. Native memory width is explicit in
  HIR; numeric specialization cannot silently turn a byte load into a double
  load. The verifier rejects disagreements.
- Native pointer bits never pass through `number`, managed array helpers, or
  reference counting. Phantom brand reads, object-based pointer construction,
  casts between pointee identities, boxing into `unknown`, and native pointers
  in ordinary TS arrays remain refused. Node-API does not marshal these pointers.
- This slice supports ordinary scalar memory, not atomic or volatile accesses.
  No new runtime helper or runtime object header is introduced.

## Second executable slice: borrowed native structs

[The poll example](../examples/interop/native-poll/src/main.ts) now calls a real
C library from TS. C owns a pipe and a `struct pollfd`; TS sets its fields,
calls libc's `poll`, and observes the result through a previously taken address:

```ts
import type { Ptr } from "c:types";
import type { PollFd } from "c:poll";
import { addrOf } from "c:memory";

// Inside a function receiving request: Ptr<PollFd>:
request.events = 1;
request.revents = 0;
const events = addrOf(request, "revents");
// poll(request, ...) may change that same storage.
const observed = events[0];
```

The binding describes `PollFd` as
`Struct<{ fd: c_int; events: c_int16; revents: c_int16 }, "pollfd">`.
`Struct` is a schema for native payload storage, not a managed object or an
allocation. The optional tag names the C struct. Generated headers also expose
aliases named after the exported function and parameter, so C callers do not
need a generated internal type name for an unnamed schema.

Implemented behavior:

- `p.field` reads/writes the declared slot. Numeric fields project as ordinary
  TS numbers, with the same width conversions as scalar pointer indexing.
  Pointer fields retain their pointer type and bits.
- `p[i]` on a struct pointer returns an address to that element, with the whole
  padded struct size as its stride. `const alias = p[0]` aliases storage; it does
  not copy a struct. `p[0] = p[1]` and object spread are refused.
- `addrOf(p, "field")` returns a pointer to the field's declared native type.
  `addrOf(p, i)` returns the address of an element. This two-argument form keeps
  the native field type that is intentionally projected away by a value read.
  Receiver, computed field key, and index expressions retain their evaluation
  order and execute once, including in compound assignments.
- Fields are required scalar brands or native pointers, declared together in
  source order. Natural C padding and alignment come from one layout routine
  shared by C and LLVM. Generated C checks size, alignment, and every offset.
  Two incompatible schemas naming the same C tag cause an emission error.
- No `NtsHeader`, reference counting, allocation, or runtime helper is added for
  native storage. The caller supplies its lifetime, bounds, and alignment.
  Taking a field address does not extend that lifetime. ResourceFlow does not
  enforce these obligations yet.

The executable tests compare a mixed-width struct with a separately compiled C
implementation and compare `pollfd` against the platform's `<poll.h>`. They run
C and LLVM output; the poll case runs with both no-GC and reference counting.
Changing only a generated LLVM field offset makes the unchanged C consumer fail.

This slice targets the current Linux LP64 ABI. Inline nested aggregates, fixed
arrays, unions, packed fields, bitfields, native const/volatile qualifiers,
by-value calls, local allocation, `sizeof` in TS, and explicit aggregate copying
remain unimplemented. Directly constructing a `Struct` schema as a JS object is
refused. The poll declaration is hand-written and tested against the system
header; it is not a header importer. Generated definitions and the original C
header's definitions of the same tag must currently live in separate translation
units, as the example's independent layout check does.

## Direction for the next executable slices

1. **Allocation and more native storage.** Exercise local storage, fixed arrays,
   `sizeof`, allocation failure, byte-count overflow, alignment, `void *`, and
   const-qualified pointers. Prefer a typed `malloc` that keeps malloc's
   byte-count convention over a new allocation vocabulary. Decide explicit copy
   semantics before lowering copies. Derive foreign declarations/layouts from
   actual C headers rather than expanding a library of hand-written ABI copies.
2. **Callbacks, then retained asynchronous I/O.** Let application code use TS
   callback syntax, while binding information specifies the C function pointer,
   context, retention, thread, and exception contract. Prove synchronous callback
   behavior first. A retained callback must have explicit lifetime and cleanup
   even before ResourceFlow exists; capturing closures cannot be reinterpreted
   as bare C function pointers.
3. **ResourceFlow.** Add checked ownership, borrowing, escape, and cleanup facts
   over those operations. Keep unknown facts distinct from proved absence of
   mutation or escape. Introduce the ownership vocabulary together with its
   enforcement, not as an unenforced promise in type declarations.

These are design directions, not exported APIs. Each slice should include a real
C consumer and a failure control before this document claims it works. Revise
syntax from the examples; avoid compatibility layers for abandoned proposals.
