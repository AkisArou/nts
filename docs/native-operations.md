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
  writes. These are caller obligations for raw pointers. Local-storage escape checks
  described below do not provide general bounds or heap-lifetime checking.
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
C library from TS. Its first version borrowed a `struct pollfd` from C; TS sets its fields,
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

This slice targets the current Linux LP64 ABI. Inline nested aggregates and array fields, unions, packed fields, bitfields,
native const/volatile qualifiers, by-value calls, and explicit aggregate copying
remain unimplemented. Fixed local array blocks, local allocation, and `sizeof`
are implemented by the next slice below. Directly constructing a `Struct` schema as a JS object is
refused. The poll declaration is hand-written and tested against the system
header; it is not a header importer. Generated definitions and the original C
header's definitions of the same tag must currently live in separate translation
units, as the example's independent layout check does.

## Third executable slice: TS-owned native storage

The [poll example](../examples/interop/native-poll/src/main.ts) now creates its
request storage in TS. The C caller only supplies file descriptors:

```ts
import { local, sizeof } from "c:memory";
import { malloc, free } from "c:stdlib";
import type { PollFd } from "c:poll";

const request = local<PollFd>();       // one zero-initialized native struct
const pair = local<PollFd>(2);        // two contiguous, zero-initialized elements
request.fd = fd;
pair[1].fd = otherFd;

const heap = malloc<PollFd>(2 * sizeof<PollFd>()); // byte count, not element count
if (heap !== null) {
  try {
    heap[0].fd = fd;
    // Initialize every field that C will read, then call the library.
  } finally {
    free(heap);
  }
}
```

`local<T>()` and `local<T>(count)` return `Ptr<T>`. A count must be a positive
compile-time constant (literals, literal-valued bindings, or constant arithmetic).
Each function has a 65,536-byte source storage budget, including struct padding.
Storage is naturally aligned and zero initialized on executing `local`.
Assigning the pointer aliases the same storage. No aggregate copy is implied.
The layout routine lives in HIR, shared with both emitters and `sizeof<T>()`;
C still independently asserts size, alignment, and offsets.

Local addresses cannot be returned, stored in native or managed storage,
captured by closures, freed, or passed to a callee without a borrowing contract.
Derived field/element addresses and control-flow aliases carry the restriction.
Direct TS callees earn their borrowing facts from their bodies; unknown or
recursive summaries remain unproved. Native calls require an explicit declaration
contract, for example:

```ts
/** Uses the array synchronously; retains and returns no address into it.
 * @ntsNoEscape fds
 */
export function poll(fds: Ptr<PollFd>, count: c_ulong, timeout: c_int): c_int;
```

This annotation is a borrowing promise made by the binding author, not proof
about a C implementation. The callee must not retain or return an address into
the storage, nor free, reallocate, or otherwise invalidate that storage. It may
read and write live elements within the supplied bounds. Merely not retaining
the address is insufficient: a deallocator cannot truthfully carry this contract.
It names pointer parameters; missing names, nonpointer names,
empty tags, and duplicates are refused. Unknown retention never means safe to
borrow. Existing documentation can share the leading JSDoc block.

This first local-storage contract also refuses allocation sites inside loops and
any function that suspends. Allocate fixed scratch storage outside a loop and
reuse it explicitly. The HIR inliner does not transplant a local-storage function
into another frame. These restrictions prevent per-site stack slots from being
reused while an earlier alias survives. They are checked before suspension and
again by the prepared-HIR verifier.

`sizeof<T>()` is the complete native storage size in bytes, including padding.
It takes a type, creates no value, and has no runtime cost. Managed object types
and incomplete struct schemas have no native payload size. A pointer type itself
has pointer size, including an opaque pointer.

`malloc<T>(byteCount)` calls C's allocator with the byte count after checking it.
Nonfinite, negative, fractional, undersized (less than `sizeof<T>()`), and above
`Number.MAX_SAFE_INTEGER` counts return null without calling malloc. Zero returns
null deterministically. Allocation failure also returns null. Arithmetic before
the call is still TS number arithmetic; these checks do not recover precision
already lost while computing a number. Storage is uninitialized, suitably aligned
for supported native types, and receives no managed header or automatic cleanup.
`free(null)` is a no-op. A successful allocation's base address must be freed
exactly once; aliases must not be used afterwards. Heap ownership, arbitrary
pointer bounds, and those temporal obligations remain manual until ResourceFlow.

Execution tests use a separately compiled C witness for zeroing, alignment,
stride, and writes. An interposed allocator verifies exact byte counts, invalid
counts making no call, real allocation failure, and cleanup. It consumes the
allocated pointer so optimization cannot erase the allocation being measured.
Removing only the integral-byte check from generated LLVM makes the unchanged
caller fail. Refusal controls exercise returns, joins, field addresses, captures,
stores, unclassified calls, freeing locals, suspension, loops, and the stack
budget. The valid local-storage function stays in each refusal fixture.

## Fourth executable slice: a generated witness against the real header

A binding is a claim about someone else's type. `program.c` already asserts
`sizeof`, `_Alignof` and every `offsetof` against the C compiler -- but for the
struct *this program declared*, since both sides are computed from one field
list. Those assertions cannot notice that the declaration disagrees with the
library it names.

`nts emit-c` now also writes `native_witness.h`: the same claims, plus two the
numbers cannot express, for a translation unit that includes the real headers to
accept or refuse.

    _Static_assert(sizeof(struct pollfd) == 8u, "pollfd size");
    _Static_assert(offsetof(struct pollfd, events) == 4u, "pollfd.events offset");
    _Static_assert(_Generic(&(((struct pollfd *)0)->events), int16_t *: 1, default: 0), "pollfd.events type");
    extern int poll(struct pollfd *, unsigned long, int);

**`_Generic` over the address of a field, never the field.** A field's own
qualifiers do not survive lvalue conversion: a `const int` member answers `int`,
so the value form accepts a declaration that silently drops the `const`. Taking
the address keeps them, because `const int *` and `int *` are distinct types.

**The prototype, because an incompatible redeclaration is an error.** A call
expression that merely compiles is not the same check: the arguments of
`poll(p, n, t)` convert, so a wrong parameter width still builds. Redeclaring
beside the real header refuses a wrong width, a wrong return type, a wrong
pointee, a spurious `const`, and a prototype that is wrongly variadic -- each
verified, not assumed.

It is one text. `native_prototype` builds the string that `program.c` declares
the symbol with and that the witness re-declares it with; two derivations could
drift, and a witness agreeing with a prototype nobody emitted checks nothing.

**Why the layout numbers are not enough, demonstrated rather than argued.**
Change `events` from `c_int16` to `c_uint16`: size, alignment and every offset
are unchanged, so a layout-only witness is byte-identical between the two. The
test asserts that identity, and then asserts that the real `<poll.h>` accepts
one and refuses the other. Removing the `_Generic` emission makes the test fail
-- checked by doing it, because a control that cannot fail measures nothing.

**No `#include` for the bindings.** Which header declares `poll`, under which
target, sysroot and defines, is the consumer's fact rather than the program's;
inventing one here would assert something nobody said. The consumer includes its
headers and then the witness. `<stddef.h>` is not an exception -- `offsetof` is
the assertion mechanism, not a binding.

**Only foreign declarations appear.** `native::Struct` now records whether its
name is a C tag the declaration authored or a spelling invented for a layout
that exists only in this program. That is a fact, not a name prefix: an invented
one is `NtsNative_Type{id}`, and a question answered by a prefix gets answered
again, differently, by whoever writes the next prefix test. A layout this
program invented names nothing outside it, so no header can be asked about it.

**What this does not establish.** It checks the properties it names, on the
declarations a program actually uses -- a binding nothing calls is not witnessed
until something calls it. It is not a header importer: the declarations are
still hand-written, and checking them is not deriving them. It says nothing
about another backend's argument placement, and nothing about whether the
symbol the linker finds is the one the header described. `examples/interop/
native-poll` keeps its runtime comparison and its linked, executed caller for
those.

## Fifth executable slice: `void *`

`Ptr<unknown>` is C's `void *`. `examples/interop/native-fd` is the consumer: a
bounded `read` into a fixed local byte buffer TypeScript owns.

**The conversion is TypeScript's, not an invented rule.** Every `Ptr<T>` is
assignable to `Ptr<unknown>` under ordinary variance, which is precisely the
conversion C performs at the call. The reverse is not assignable, and that is
the direction mistakes live in -- turning an address of unstated type back into
a typed pointer is a claim nobody checked. Lowering refuses it a second time,
so the type system is the first of two guards rather than the only one.

Only `unknown`. `Ptr<any>` stays refused: `any` is what a program ends up with
by accident and `unknown` is what someone writes on purpose.
`TypeKind::Unsupported` is a third thing again -- the checker saying it rendered
something we do not model -- and reading that as `void *` would turn every
unmodelled type into a pointer nobody declared.

**`void` has no element type.** `Pointee::Void` answers `None` to
`element_type`, so `p[i]` and an index address do not exist for it. A `void *`
is an address to hand onward, not storage this program may read through.

**What the witness found.** The first binding written for `read` declared the
buffer as `Ptr<c_uint8>`. It typechecked, lowered without a diagnostic, and
produced a `program.c` that compiles -- `program.c` declares `read` itself and
never sees `<unistd.h>`. The witness translation unit does, and refused with
`conflicting types for 'read'`. Narrowing it against the header showed the
buffer was the *only* conflict: `ssize_t` and `ptrdiff_t` are the same type on
this target, so `c_ptrdiff_t` is accepted for the result. The witness
establishes ABI identity, not that a binding names the same typedef a header
does, and that limit is worth stating rather than discovering.

That arm is checked as a control, and checked to fail: if the typed-buffer
binding ever compiles, the witness has stopped checking prototypes and the
example proves nothing.

**One backend bug, found by having two.** LLVM emitted `add ptr %v, 0` for the
conversion -- the no-op idiom the backend uses for same-width integers, which is
not an instruction for a pointer. A pointer's no-op is a zero-offset
`getelementptr`. The C backend had been correct throughout; only assembling the
IR found it.

## Sixth executable slice: taking an address the way C writes it

`addrOf(requests.revents)` is `&requests->revents`. It replaces
`addrOf(requests, "revents")`, which passed the field name as a value and so
spelled a second time what the type already knew.

**The problem, stated plainly.** C takes an address with a prefix operator on an
lvalue. TypeScript has neither, so this is a call -- and a call's signature
cannot say that only some expressions denote storage. `addrOf(42)`,
`addrOf(a + b)` and `addrOf(f())` are the same shape to a type checker as
`addrOf(p.fd)`. Any single-argument form has to answer that, and it cannot be
answered by the signature alone.

**Two mechanisms answer it, and neither could alone.**

A native slot's type carries a phantom naming what it is a slot *of*:

    type Slot<T> = T extends number ? number & { readonly __c_of?: T } : T & { readonly __c_of?: T };

The phantom is **optional**, which is the whole trick. Optional, so a plain
`number` satisfies it and `p[i] = n`, `p[i] += 1` and `p.count += 2` stay
ordinary arithmetic. Present, so `addrOf` can infer the declared C type:

    export function addrOf<T>(place: { readonly __c_of?: T }): Ptr<T>;

Both halves are load-bearing. Brand the slot itself and every write becomes a
conversion, including the compound assignments, which cannot be written as one.
Strip it and `addrOf(p.events)` infers `Ptr<number>` -- a pointer naming no C
width, unusable for the load it exists to perform.

Nothing outside native storage carries that phantom, so **TypeScript** rejects
`addrOf(42)`, `addrOf(f())` and the field of a managed object, before the
compiler is consulted. A managed object is refused permanently rather than
pending: its representation belongs to the compiler, and handing out an interior
address would fix a layout that reference counting and specialization own.

What types cannot see is `addrOf(c ? p.x : q.x)` -- both branches are slots, and
the conditional is not a place. That is refused at **lowering**, from the
syntax: only a member and an element access denote a place.

`compiler/core/tests/native_scalars.rs` asserts *which* mechanism catches each
arm rather than only that it was caught, because a mechanism that stops working
otherwise hides behind the other one.

**One bug this found on the way in.** The first version dropped
`lower_expression` on the member, and `p[key()]` stopped calling `key()`. The
address is identical either way, so nothing in the emitted C would have looked
wrong; `native-structs` caught it at run time by counting the calls. A computed
key is an expression and still runs.

## Seventh executable slice: `const` views

`write` takes `const void *`, and until now nothing could say so. `ConstPtr<T>`
is that view, and `examples/interop/native-fd` writes through it.

**What it claims, and what it does not.** `const` in C restricts *this holder*.
It is not a claim that the storage is immutable, and not a claim that nobody
else holds a mutable pointer to the same bytes. Saying more than that would be
an ownership promise with no checker behind it.

**The marker sits on the mutable type.** `Ptr<T>` carries `__c_writable`;
`ConstPtr<T>` does not, so const is the *smaller* type. A `Ptr<T>` therefore
satisfies a `ConstPtr<T>` and a `ConstPtr<T>` does not satisfy a `Ptr<T>` --
exactly C's qualification conversion, in the one direction C performs it, out of
TypeScript's own assignability rather than a rule written here. Put the marker
on the const type instead and the relation inverts, forcing a conversion at
every call site that passes its own buffer.

TypeScript enforces the rest as well: writing through a const view is `TS2542`,
"only permits reading". Lowering refuses the store again rather than trusting
that, because a program can declare an intrinsic for itself whose type and
contract disagree.

**`Pointee::converts_to` is where the conversion set is stated.** C performs two
implicit pointer conversions -- any object pointer to `void *`, and adding
qualification -- and they compose, so `uint8_t *` reaches `const void *`. It
recurses rather than listing pairs. Neither direction that loses information is
in it.

**What is refused, and named.** The address of a member or element of a const
view: in C that is a `const U *`, and `addrOf` hands back a writable pointer, so
returning one would launder the qualifier. Giving it back qualified needs the
surface to tell a const slot from a mutable one, and today `Slot<T>` is the same
type in both -- the read-only-ness lives on the container. Refused with a
diagnostic that says which, rather than the general "without a native struct
layout" that was true and useless.

## Direction for the next executable slices

1. **More native storage and header-derived bindings.** `void *`, const-qualified
   pointers, inline arrays/aggregates, and explicit copy semantics still need
   executable examples. Derive foreign declarations/layouts from actual C headers
   rather than expanding a library of hand-written ABI copies.
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
