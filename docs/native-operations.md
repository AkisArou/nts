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

## Where a foreign call's facts attach

`escape.rs` treated every foreign callee as reaching anything at all:
`bodies_reached` answered `None` for `Callee::External` and `Callee::Native`
together, and every argument was assumed kept. `@ntsNoEscape` was authored,
validated where the signature is built, and consulted by `native_storage` -- and
the analysis that decides placement never read it.

It does now, through `gone_into_the_unknown`, which already received the callee.
Two foreign populations answer there and they answer from different evidence: a
runtime helper or a bound Java member from `runtime::keeps`, keyed by name; a
`declare`d C function from its own declaration. Deliberately *not* a name table
for the native side -- that would be a second derivation of what the declaration
already states, and the two would disagree the first time a binding was renamed.

`None` means **unknown**, and unknown means every argument escapes. Keeping that
distinct from "nothing escapes" is the whole content of the function: collapsing
them hands an optimizer a permission nobody established.

**This changes no placement today and the test says so.** `@ntsNoEscape` is
accepted only on native pointer parameters, and those never reach
`place_allocations` -- `NativeMalloc` is its own operation precisely so the
frame-capacity name list cannot catch it, and `NativeLocal` is placed
explicitly. The two populations are disjoint by construction. What this buys is
the attachment point: one place where a foreign call's declared facts are read,
before there are more of them to read.

The test asserts the verdict from `escape::analyze_program` directly, on two
programs differing in one line of JSDoc, because a check that went through
placement would pass for a reason unrelated to whether the declaration was read.

## Eighth executable slice: a struct stored inline in another

`struct itimerval` is two `struct timeval`s by value. That shape is most real C
structs, and a header importer meets it immediately, so it was the gap worth
closing before deriving anything.

A struct-typed member is stored **inline**: the nested layout's bytes sit in the
outer one. `native_shape` already knew how to size and align that -- the missing
piece was the schema, which pushed every non-scalar member through the pointer
case and so refused a `Struct<...>` as "not a pointer".

**A member projects as a pointer to itself, never as a value.** Reading one as a
value would be an aggregate copy, and `p.it_value.tv_sec` should reach the bytes
that are there rather than a duplicate. This is what `p[i]` already does for a
block of structs, for the same reason.

**What is refused is a type C cannot lay out.** A struct containing itself by
value, or two containing each other, have no size; `visiting` refuses them where
the members are read. A struct containing a *pointer* to itself is a different
thing and remains refused for its own older reason -- a recursive pointee needs
a separately named incomplete type -- which predates this and was checked
against the previous compiler rather than assumed.

**Emission order became load-bearing.** C wants a *complete* type for an inline
member and a forward declaration is not one. `layouts.structs` is keyed by name,
so `itimerval` was emitted before the `timeval` inside it and the translation
unit said `field has incomplete type`. `emit-c` reported success while doing
it. Definitions are now ordered by their inline dependencies, and a set that
cannot be ordered is reported rather than truncated -- it would mean the emitter
and the schema disagree about a cycle.

Only compiling the output catches that, so the test compiles `program.c` as well
as the witness, and a sabotage back to name order fails it.

**The witness carries the whole claim.** Against the real `<sys/time.h>`: both
sizes, both alignments, every offset, and `_Generic` on the nested member, which
must answer `struct timeval *` and would not if the member had been described as
a pointer or flattened into its fields.

## Reading headers: the measurement, and what it decided

Before building a header importer there was a choice to make and no evidence
behind it: a clang **subprocess** consuming structured output, or **libclang**.
Both were measured on one header carrying the shapes that matter -- a typedef
chain, an incomplete record used only by pointer, a complete record with
padding, a `const` pointer, a bitfield, a nested record, function pointers
including a nested declarator, a conditional declaration, a variadic, and a
signedness-sensitive return.

**It was not decided on speed.** The JSON AST dump ran in 0.01s at 124 MB peak;
the libclang traversal in 0.04s at 109 MB. At this size neither is disqualified,
and the difference is noise — single runs on a 35-line header.

**It was decided on whether one derivation can answer.**

`clang -Xclang -ast-dump=json` gives declaration identity, spelled and desugared
types, qualifiers and signedness. It gives **no layout at all**: the 439
`offset` keys in that output are *source* offsets inside `loc` records. Nothing
in the JSON says where a field sits.

Layouts need a second invocation, `-fdump-record-layouts-complete`, whose output
is column-aligned text with `*** Dumping AST Record Layout` separators and
`[sizeof=24, align=8]` trailers — undocumented, and not the same format as the
first. So the subprocess path is two parses of one header that must then be
correlated.

**The correlation has no key.** On the probe header the layout dump emitted 7
records where the JSON had 6 `RecordDecl`s, and 2 of the 7 were spelled
`struct (unnamed at /usr/include/bits/types.h:155:12)` — identified by source
location and nothing else. Anonymous records are ordinary in real headers. That
is one fact reached by two derivations joined on something that does not exist
for part of the population, which is the failure this lane has now met from
three directions in one day.

libclang answers all of it in a single traversal, through a documented stable C
interface: `clang_Type_getSizeOf`, `clang_Type_getAlignOf`,
`clang_Cursor_getOffsetOfField`, `clang_Cursor_isBitField`, and cursors as
identity. On the same header it reported `struct outer` as `sizeof=40 align=8`
with `const char *` still qualified and the bitfield flagged.

**libclang, then**, for one reason: the subprocess path cannot answer the layout
question from the same derivation as the type question, and a binding needs both
to be about the same declaration.

Not because a subprocess is awkward to drive. An earlier version of this
paragraph said some of these options are `-cc1` only and would mean
reimplementing the driver's include discovery. **That is wrong.** `-Xclang`
forwards a frontend option through the driver with its include paths intact:

    clang -x c - -fsyntax-only -Xclang -fdump-record-layouts-complete

reports `sizeof=16, align=8` with offsets 0 and 8 for a struct that includes
`<stddef.h>`. A run in the same session had already shown exactly that, and it
was written down backwards: `-cc1` was invoked directly, failed for want of
include paths, and that was generalised into a property of the options. It is
corrected here rather than quietly dropped, because it was given as a *reason*
for a decision. Invoking clang remains a dependency -- a configured executable
rather than a library -- but not a heavier one for that reason.

Neither path escapes the target question: triple, sysroot, defines, include
paths and invalidation are required either way, and verification needs them too.
That was never the difference between them.

## Ninth executable slice: C calls a TypeScript function

`examples/interop/native-callback` hands a compiled TypeScript function to a
separately compiled C library, which calls it twice, synchronously, on the
caller's thread. Non-capturing only; this is the ordered first half of callbacks
and nothing here is retained past the call.

**The binding writes an ordinary TypeScript function type.** At a C ABI boundary
that can mean one thing, so no wrapper type is invented to say so. Every
parameter and the result are described by the rules already in use.

**A TypeScript function value is not a code pointer, and the bridge is a thing
in the program rather than a cast.** This was not a theoretical hazard: the
first version described the parameter correctly and left the argument alone, and
the specializer -- which converts every native argument to its parameter's
`representation()` -- took the *closure object's heap address* and handed it to
C as something to call. `emit-c` reported success. The emitted prototype was
right, so the witness could not see it: the header and the prototype agreed and
only the value was wrong. That is the shape a header check is blind to.

So `NativeBridge` is an operation, and each backend emits a real function with
the foreign signature that calls the compiled one. Two backends, two texts, one
symbol name derived the same way in both -- a program compiled by either links
against the same consumer.

**Non-capturing is checked by construction.** The argument's producing operation
must be `ClosureStatic`. A capturing closure has state a bare code pointer has
nowhere to put; an *inline* function expression is allocated as a closure object
even when it captures nothing, so it is refused too and the diagnostic says
which to write. Making a non-capturing arrow a static closure would remove that
restriction and is a separate change.

**Three things this broke on the way in, each invisible in a different way.**

The bridged body was pruned. Nothing in the program calls it -- C does, later --
so reachability dropped it, the vtable slot was emitted as a null, and the
backend reported "a closure publishes no function". That walk matches `Call`
specifically rather than exhaustively, so the compiler does not ask about a new
operation that reaches a function without calling it.

The closure's local became dead in C. A bridge names a symbol and reads nothing
at run time, so the local was assigned and never read: `-Wunused-but-set-variable`,
an error under the flags the generated file is compiled with. The operand is
real in the HIR, where it identifies the function and keeps the body alive, so
the C emitter asks a narrower question than `operands_of`.

And the LLVM implementation was written and not routed. The dispatch that sends
an operation to the renderer is a list, and the comment beside it already said
what happens: an implementation nothing routes to reads exactly like one that
was never written.

**A throw inside a callback stops at the boundary.** This had to be settled
before the synchronous case could be claimed to work, and the answer was not the
one already in place.

A `throw` reaches `nts_uncaught`, which longjmps to the innermost landing an
embedder installed. Between the throw and that landing are now *C frames* --
belonging to a library that called us and knows nothing about a non-local jump.
Jumping over them skips whatever they hold: a lock, an allocation, an iterator
half-advanced. The runtime already states this cost for its own boundary; a
callback extends it over code the runtime has never seen.

So a bridge raises `nts_callback_enter` around the call, and while that count is
non-zero a throw is not delivered outward at all. The process ends, naming the
boundary and the message. The policy lives in the runtime, so both backends get
it from two calls rather than each implementing a rule.

**Not a return value**, deliberately. A C function pointer's signature has no
error channel, and inventing one is worse than stopping: a comparator that
answers 0 because it failed sorts the array wrongly and says nothing.

The example checks this in a forked child, with an embedder landing installed --
that is the case where the two behaviours differ. Disabling the guard turns the
child's exit from 1 into 7, "the throw jumped out, skipping the C frame
between", which is the hazard stated as an observation rather than a worry.

**What libc's own callbacks still need.** `qsort` and its family take
`void *` and expect the callback to cast. Reading through a `void *` is exactly
what `Pointee::Void` refuses, so a real libc callback needs a checked way to
turn an address of unstated type back into a typed one -- which is the direction
mistakes live in, and is not this slice.

## What a call keeps: the first effect, stated as one

`native::Function` carried `no_escape: Vec<bool>`. It now carries
`retention: Vec<Retention>`, with two cases:

    Unknown       nothing was established
    NotRetained   authored: nothing of this argument outlives the call

**`Unknown` is not "may be retained" spelled pessimistically.** It is the
absence of a claim, and keeping it distinct from a proved one is the whole
content of the type. A `false` said both things at once; every analysis reading
it had to know which was meant, and nothing in the type said.

**One axis, because one axis is what the published calls need.** A pointer the
callee does not keep and a callback the callee does not call later are the same
fact about two kinds of value: nothing of this argument outlives the call. So
`@ntsNoEscape` now applies to a function-pointer parameter as well, meaning
there what it already meant for a pointer.

For a pointer the contract has to name more than non-retention -- freeing or
reallocating invalidates the storage as surely as keeping a pointer to it does
-- and it does. For a callback it means the callee does not call it after
returning.

**What turns on it, and what does not.** A non-capturing callback's own
retention gates nothing today: its bridge and its closure singleton are both
immortal, so a callee that keeps one harms nothing.

The **context** is a different matter and gates immediately. `each_upto` takes a
callback and a `Ptr<Counter>` the caller owns, and `native-callback` passes a
*local*:

    @ntsNoEscape f ctx      accepted -- the local may be the context
    (ctx left Unknown)      refused  -- "native local address escapes"

That is the same check that already governed a borrowed pointer, reached through
a callback, and it is the reason the contract had to exist before this shape did
rather than after.

Reads versus writes, acquisition and release, outcome-dependent transitions --
those are further axes. They belong beside this one when a binding needs them,
not inside it, and not before.

## Exact 64-bit integers

`c_int64` used to be a branded `number`, and a `double` holds every integer to
2^53 exactly and nothing beyond. Measured, with a correct `int64_t` prototype at
both ends:

    9007199254740993  ->  9007199254740992     rounded
    INT64_MAX         ->  INT64_MIN            a sign flip
    2 of 4 boundary values survived a round trip

The prototypes were right, so nothing checking a binding against a real header
could see it. The loss was entirely inside, in an `i64 -> f64 -> i64` detour.

**The six LP64 spellings are `bigint`-branded now**: `c_int64`, `c_uint64`,
`c_long`, `c_ulong`, `c_size_t`, `c_ptrdiff_t`. Narrower integers and floats
stay `number`, because a double carries those exactly. Giving `int64_t` exact
values while `size_t` -- the same 64 bits -- silently rounded would have been
the worse of both.

**The ABI did not move.** `Scalar::representation` still answers `i64`, the
emitted prototype is still `int64_t`, and no C layout changed. What changed is
the type a TypeScript value of the brand has *in between*, which is the only
place the loss was happening. Confusing those two would have turned the ABI into
`__int128`, which is a different boundary and the existing managed-host one.

**The brand and its base must agree**, and a mismatch is refused rather than
reinterpreted. A `c_int64` written over `number` would be exactly the lossy
thing this prevents, and would still emit a correct prototype.

**Conversions, by direction.** Widening reads the *source's* signedness:
`UINT64_MAX` becomes 18446744073709551615 and not -1. Narrowing takes the low
64 bits, which is `BigInt.asIntN(64, x)` for a signed destination and `asUintN`
for an unsigned one. Both were missing from the LLVM conversion table and fell
to its refusal; the C backend's casts already did the right thing, so only
assembling the IR would have found it.

**The cost is real and is at the boundary, which is where it belongs.** A
`size_t` count converts explicitly on the way in and an `ssize_t` result on the
way out:

    read(fd as Fd, buf, BigInt(max) as Count)
    Number(read(...))

`sizeof`, `local` and `malloc`'s byte count keep their `number` API: they are
compiler operations with their own checks, not a claim to expose the whole
`size_t` domain.

**Tested as two families rather than one.** The old test named every brand and
asserted number semantics for all of them, which recorded a policy rather than a
fact. There is no test spanning both now, because there is no expression that
spans both -- mixing a bigint and a number is a type error, and that is the
property that makes the exactness hold rather than a restriction beside it. The
wide family round-trips INT64_MIN, INT64_MAX, UINT64_MAX, SIZE_MAX, PTRDIFF_MAX
and 2^53+1 through a separately compiled C library, in both backends, and
asserts that no value in either direction passed through a double.

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
