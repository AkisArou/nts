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

`nts emit-c` now also writes `native_witness.c`: the same claims, plus two the
numbers cannot express, in a translation unit that includes the real headers and
is compiled on its own.

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
It takes a `Spelling`, which is the one thing the two consumers may differ on:
`program.c` defines the function-pointer typedefs and names them, the witness
has none of them in scope and spells `int (*)(int)` out. Order, arity and the
`void` for an empty list are still produced once, for both.

**Why the layout numbers are not enough, demonstrated rather than argued.**
Change `events` from `c_int16` to `c_uint16`: size, alignment and every offset
are unchanged, so a layout-only witness is byte-identical between the two. The
test asserts that identity, and then asserts that the real `<poll.h>` accepts
one and refuses the other. Removing the `_Generic` emission makes the test fail
-- checked by doing it, because a control that cannot fail measures nothing.

**The binding names its own headers, and this reversed an earlier decision.**
It first shipped as a `.h` fragment with no includes, on the reasoning that
which header declares `poll` is the consumer's fact rather than the program's.
That was wrong, and not subtly. A fragment is compared against whatever the
enclosing file includes, so the file that discharges the check also *chooses*
the check -- a binding naming the wrong header would still have been compared
against the right one, and agreed. Four of the five witnesses in this tree were
wrapped by hand, each wrapper repeating an include; the fifth,
`native-callback`, had no wrapper at all, so its witness had never once been
compiled. It named a typedef that exists only in `program.h`.

So a binding declares what it describes, and the generated file is a complete
translation unit:

    /**
     * @ntsHeader sys/utsname.h
     * @ntsDefine _GNU_SOURCE
     */
    declare module "c:utsname" {

The tags sit on the `declare module`, which is the scope a header corresponds
to; a source file may carry them too, for a program that declares a foreign
struct inline rather than importing a binding. `@ntsDefine` is not a
convenience. glibc's `struct utsname` names its sixth member `domainname` under
`__USE_GNU` and `__domainname` without it, so the same header is two different
structs and a witness that does not say which one it read is not making a
claim. Macros are emitted before every include, which is the only position in
which a feature-test macro does anything.

`<stddef.h>` and `<stdint.h>` are the exception that proves it -- `offsetof` is
the assertion mechanism and `uint8_t` is how a scalar is spelled, so both are
emitted unless a binding already names them.

**The program includes what a binding names, and defines only what nothing else
does.** A foreign struct is a type some header defines, and `program.h` used to
define its own copy -- so a C consumer could not include both it and the real
header, which is an odd property for a file whose purpose is being included.
`native::Struct` records whether the scope that declared it named a header;
where one did, the include supplies the definition.

That moves a check rather than only removing a wart. The `_Static_assert`s in
`program.c` compared two derivations of one field list, so they verified the
arithmetic and could not notice a wrong binding; against the included header
they are the C compiler answering about the real type. A length of 64 where the
header says 65, or a missing sixth member, now refuses `program.c` itself --
verified by making each change.

Macros are *defined* at the top of `program.c`, which nts owns to the first
line, and *required* by `program.h`, which cannot be first: an includer that
reached for `<stdio.h>` has already fixed what `struct utsname` is, so a
`#define` there would work in the easy case and silently produce a different
struct in the other. `program.h` stops the build with a message naming the flag.

**A module is named for the header it describes**, path and all:
`c:sys/utsname`, `c:arpa/inet`, `c:sys/epoll`. Dropping the directory reads
better and cannot be spelled: `time.h` and `sys/time.h` are both real and
different headers, and both would be `c:time`. The modules that describe no
header keep flat names, because they are not headers -- `c:types` is the brand
vocabulary and `c:memory` is the compiler's own storage operations.

**A header tag names what a module describes, not what it sounds like.**
`c:memory` carried `@ntsHeader string.h` for a while on the strength of its
name, and it declares not one C function -- every export is an intrinsic. The
tag added `#include <string.h>` to every program that named any header-backed
struct and gave the witness nothing to check. Same for `c:stdint`, `c:stddef`
and `c:stdbool`, which publish type aliases and no functions. `c:stdlib` and
`c:math` keep theirs: they declare real prototypes the witness re-declares.

**What remains is a flat union, and it shows.** Every *declared* module's
headers are included, not every *used* one, so a program touching one native
struct still gets `<math.h>` and `<stdlib.h>` from `libc.d.ts`. That is noise
rather than a hazard -- `symbols::RESERVED` already renames a program's own
`round` to `round_`, which is why the collision this was expected to cause does
not happen, checked rather than assumed. Scoping it needs per-module provenance
on each record and function, which is the "which header, not whether" question
deliberately deferred.

The includes are emitted only where a layout needs them. An include is not free
in this file -- `<stdlib.h>` declares `div`, a name a TypeScript program is
entitled to export -- so a program naming no header-backed struct gets none.

## Which of these checks can actually fire

A guard nobody reaches does not read as unbuilt -- it reads as protection. So
for every refusal added here, the question asked was not *is it correct* but
**which call sites reach it**, and the answer is written down rather than
assumed. Each row below was run.

| refusal | reachable from TypeScript? | how it fails |
|---|---|---|
| `NTS2007` conflicting ABI | yes | `emit-c` exits 1: the emitted call is wrong |
| an anonymous record in a record we must define | yes | exits 0, and `program.c` does not compile |
| a copy between two different native types | yes | lowering refuses |
| a variadic tail C would promote | yes | lowering refuses, naming the promoted type |
| a variadic function with no fixed parameter | yes | lowering refuses |
| `bind-c`: a contract naming no parameter | yes | refuses, listing the ones that exist |
| `bind-c`: a bit-field, an anonymous record | yes | refuses by name |
| `bind-c`: a layout it cannot reproduce | yes | caught its own `c_uint32` bug |
| a copy into a `const` native view | **no** | tsgo answers `TS2345` first |
| a rest parameter that is not last | **no** | tsgo answers `TS1014` first |
| a rest parameter of non-array type | **no** | tsgo answers `TS2370` first |
| a callback entering on a foreign thread | **no**, for a standalone program | see below |

**For some of these the guarantee is not what they buy.** Delete the
conflicting-ABI check and the program still fails -- the C compiler says
`conflicting types for 'collide'` about a `program.c` nobody wrote. What the
refusal buys is naming the symbol and *both* prototypes. Same for the variadic
promotion, whose value is `declare `int``, and for a `--no-escape` naming
nothing, whose value is the list of names that do exist.

A guard like that survives "does the bad case still fail?" and dies to it, so
its test asserts **the words**: that the ABI refusal names `collide`, `size_t`
and `int`; that the promotion refusal names `uint16_t`, `int` and `declare`;
that the contract refusal names the function, the bad name, every real name and
why they differ from the header's. A message that degraded to a category would
pass a test written for one, and would be worth less than the C compiler's.

The three tsgo cases are kept and marked in place: the input here is a snapshot
rather than the source, and a malformed one should be refused. They are not
controls, and saying so is the point -- an unmarked unreachable guard is
indistinguishable from a working one.

**The thread check is the uncomfortable row.** `nts_callback_enter` asserts
`nts_is_owner_thread`, which delegates to a host. A standalone program has
installed no host and the answer is unconditionally `true`, so the guard sits
on exactly the right path and cannot fire on it. It is real for an embedder and
inert for every example here. The runtime has no way of its own to know which
thread owns it, and inventing one would be a second answer to a question the
host already owns -- so this is a limitation recorded, not a bug fixed.

## Effects: what a call does to memory, and who may say so

ABI says how bits cross. Effects say what a call does to memory and when, and
**a header cannot infer it**. Four properties, each checkable:

**One representation, not two beside each other.** `native::Function` carries
`retention: Vec<Retention>` and no `no_escape`. The authored tag is still
spelled `@ntsNoEscape` and `NativeAttributes::no_escape` is the parsed tag --
those are the *syntax*, read once in the frontend. What the HIR carries is the
fact.

**Unknown is not "nothing escapes".** `Retention::Unknown` is the absence of a
claim: the callee may keep, free, reallocate or invalidate the argument, and
may call it after returning. Kept distinct at every consumer.

**One place, two sources of evidence.** `escape::kept_slots` answers for
`Callee::External` from `runtime::keeps` and for `Callee::Native` from the
declaration's own `retention`; everything else is `None`, which means every
slot escapes. Both lanes used to share an arm that returned `None`.

**It has no observable effect on placement, and the test exists because of
that.** `@ntsNoEscape` is accepted only on native pointer parameters, and those
never reach `place_allocations` -- the two populations are disjoint by
construction, so no reachable allocation moves. Nothing downstream would notice
this fact being lost, which is exactly why it is asserted directly rather than
through a consequence.

**Preservation through HIR.** `nts hir --prepared` prints the contract on the
call -- `call.native apply_twice [-.]`, where `-` is NotRetained and `.` is
Unknown -- and a test asks the prepared program for it, with an untagged arm
that must report `Unknown`.

**An importer leaves it Unknown rather than inventing it.** `nts bind-c` emits
`@ntsNoEscape` only from an explicit `--no-escape` flag, and the generated
comment says whose claim it is. The inference it refuses to make is tempting
and wrong: `const void *` looks like a promise not to keep the pointer and is
nothing of the kind -- `const` restricts what the callee may *write through*,
and `strdup`'s argument is `const char *`. Asserted in both directions, because
a tool that had stopped emitting tags at all would pass the first half.

## Unions, packing, and the pointers that come out of them

`native::Struct` is now `native::Record` and carries a `RecordKind`. One type
for both because C has one: 6.2.5 says "structure or union type" throughout,
they share a grammar, a tag namespace and a `->`, and everything except the
keyword and the offsets is common to them. Two Rust types would have duplicated
every match arm to say the same thing twice. A tag claimed as both is an error,
which C's single tag namespace requires and nothing previously checked.

`Packed<T>` composes rather than adding a third type argument, so everything
that reads a struct keeps reading one. It has to be declared because it cannot
be inferred: a packed and an unpacked declaration of the same members are the
same text and different layouts.

**The pointer out of a packed member is a different type, and that is where the
fact has to live.** `&p->member` on a packed struct is `taking address of
packed member` -- clang reports it because the result has the member's type and
not its alignment, and loading through the aligned spelling is undefined. So
`Pointee::Unaligned` wraps it, and both backends read it at the point of use:

    typedef uint32_t NtsUnaligned_uint32_t __attribute__((aligned(1)));
    v8 = (NtsUnaligned_uint32_t *)((char *)v7 + 0);   /* C */
    store i32 %v, ptr %v8.at, align 1                 /* LLVM */

It could not have gone on the field-address *operation*, because that is not
where it is spent: the load and the store happen through the pointer value one
op later, and a backend reading only that value would have to trace it back.
It propagates through nesting too -- a record reached through a packed member
is itself at an unpredictable address, so its own members are, however it was
declared.

`struct epoll_event` is the case that makes all three matter at once: a union
of four members, packed so `data` sits at offset 4, and 12 bytes where the
natural layout is 16. `examples/interop/native-epoll` hands a descriptor to the
kernel through it and reads it back out.

## Deriving a binding from a header: clang subprocess or libclang

Measured on this box, clang 22.1.8, against `<sys/epoll.h>`, `<unistd.h>` and
`<sys/utsname.h>`.

| | clang subprocess | libclang |
|---|---|---|
| prototypes | not in the record dump at all; needs `-ast-dump=json` — **1.0 MB** for `<sys/epoll.h>`, 1.5 MB for socket + netinet | same walk, typed, with `is_function_variadic` |
| layouts | `-fdump-record-layouts` is correct, but dumps only records the TU **lays out** — one forced instance per type | `get_size` / `get_align` / `get_offset` on any definition |
| all records at once | `-fdump-record-layouts-complete` — **wrong for every packed struct** | n/a |
| include paths | the driver supplies its own resource dir | must be told, and **does not fail without it** |
| time | 0.03 s | 0.10 s including Python startup |

Two results decided it, and neither is about speed.

**`-fdump-record-layouts-complete` is wrong about packed records.** It reports
`struct epoll_event` as 16 bytes, alignment 8, `data` at offset 8 — where the
compiler says 12, 1 and 4. Not a printing bug: `_Static_assert`s in the *same
translation unit* fail under that flag and hold without it, and a `packed`
struct written by hand is wrong the same way, so it is not glibc-specific. The
only flag that dumps every record is the one that would silently generate the
exact defect `native_witness.c` exists to catch.

**libclang does not fail when it cannot find its own headers.** Parsed without
`-isystem $(clang -print-resource-dir)/include`, `stddef.h` is not found,
`size_t` is never defined, and clang error-recovers — so

    ssize_t write(int, const void *, int)

comes back, confidently, where `<unistd.h>` says `size_t`. The AST is walkable
and every answer from it is wrong in a way no later step could notice. Adding
the resource dir gives `size_t`. The driver adds it for you; the library is not
the driver, which is the whole difference.

**So: the subprocess** — and the first draft of this section said libclang,
which was wrong for a reason the measurements could not show.

`Cargo.toml` says of its external dependencies: *"Deliberately small; every
addition is a maintenance obligation."* libclang costs `clang-sys` plus
`libclang.so` on every machine that runs the tool. The subprocess costs
nothing: `serde_json` is already a dependency, and `-ast-dump=json` carries
prototypes, parameter names, `const` qualification and a `variadic` flag --

    open   int (const char *, int, ...)        variadic=true
    write  ssize_t (int, const void *, size_t) variadic=absent

-- while `-fdump-record-layouts` carries the layouts, correctly, packed ones
included.

And the two failure modes point the same way. The driver supplies its own
resource directory, so the `size_t`-becomes-`int` recovery above cannot happen;
a header it cannot find is a nonzero exit rather than a diagnostic someone has
to remember to read. **libclang's failures are silent and the subprocess's are
loud**, which decides it for a tool whose output is a claim about someone
else's ABI.

Three costs accepted, each with its handling:

- Layouts need the record to be laid out, so the tool generates a probe
  translation unit with one forced instance per requested type. It writes that
  file, so this is bookkeeping rather than a limit.
- `-fdump-record-layouts-complete` must never be used. See above.
- The JSON location model is **sticky**: of 156 `FunctionDecl`s in one parse,
  **5** carried an explicit `loc.file`, the rest inheriting the last one seen.
  Filtering by header means carrying that forward, and a reader that checks
  `loc.file` per node finds almost nothing and reports an empty header.

And whichever route: **a derived binding is still a claim.** It is generated
from one compiler's reading of one set of headers under one set of macros, and
`native_witness.c` is still what proves it against the headers the consumer
actually compiles with.

## `nts bind-c`

    nts bind-c --module c:epoll --header sys/epoll.h \
      --record epoll_event --record epoll_data \
      --fn epoll_create1 --fn epoll_ctl --fn epoll_wait \
      --no-escape epoll_ctl:event --no-escape epoll_wait:events \
      --alias epoll_event=EpollEvent --out types/epoll.d.ts

Two clang runs over two generated translation units. The first is the headers
alone, read as JSON, which says what each tag *is* and what every prototype
takes. The second adds a `_Static_assert(sizeof(union epoll_data) > 0, ...)`
per record -- a tentative definition does **not** force a layout, checked: it
produced an empty dump -- and is read with `-fdump-record-layouts`.

**The generator checks itself before it writes.** It recomputes each record's
layout by the same rules `hir::layout` uses and compares with the one clang
reported, refusing with both numbers if they differ. That caught its own first
bug: `c_uint32` had been added to the type mapping and not to the size table,
whose catch-all made it eight bytes, which put `epoll_event`'s union at offset
8 and the struct at 16. The table has no catch-all now.

It is not a substitute for `native_witness.c`. This compares against the same
clang invocation that produced the binding; the witness compares against the
headers a consumer really compiles with, under their macros.

**Two things a header does not say, so two flags.** `--no-escape f:p` is the
borrow contract, which is author knowledge: that `poll` reads its array during
the call and keeps no address into it is true, is what makes passing
`local<PollFd>()` legal, and appears nowhere a compiler could read it. Without
it a generated binding is structurally right and refuses every such call --
checked, by generating `poll.d.ts` without one and watching `emit-c` say
*native local address escapes*. `--alias tag=Name` is the other: the tag is the
header's, the declaration file's name for it is not.

Generated `utsname` and `pollfd` bindings compile their examples and their
witnesses agree with the real headers. A variadic function's tail is the third
thing a header cannot state, and it is emitted as `...rest: unknown[]` with a
TODO, which does not compile -- deliberately, so it stops at the declaration
rather than at a call.

## The four things a callback has to settle first

Item 4's order is load-bearing: exception containment, both-direction
conversion, reentrancy and thread come *before* anything retained. Each is now
asserted by `examples/interop/native-callback`, and the first three had been
present without being checked.

**Exception containment.** A `throw` inside a callback has C frames between it
and any landing -- frames belonging to a library that knows nothing about a
non-local jump, and `longjmp` past them skips whatever they hold. So while
`in_callback` is non-zero a throw is not delivered outward at all: it prints
and stops. Exercised in a forked child, because the control's expected outcome
is a dead process.

**Both-direction conversion.** The bridge converts C's argument in and the
result out. For `int` that is `(double)a0` and `(int)r`; for `int64_t` it is
`__int128`, with no `double` anywhere on the path. The test uses **2^53 + 1**,
the smallest integer a double cannot hold: through a double the answer comes
back `...93` and the assertion demands `...94`. Every value below 2^53 agrees
either way, which is why a smaller one proves nothing.

**Reentrancy.** C calls TypeScript, which calls C, which calls TypeScript
again -- four entries, each bracketing itself. `reentrant(1) = 5`. A bridge
setting a flag instead of counting passes every single-entry test and leaves
the outer frame looking like ordinary code the moment the inner one returns.

**Thread.** `nts_callback_enter` asserts `nts_is_owner_thread`, as
`nts_promise_join` already did. What it catches and what it does not is worth
being exact about: `nts_env` is `_Thread_local` but *defaults to one shared
environment*, so a second thread entering a bridge increments `in_callback`
without synchronisation and allocates against another thread's heap. An
embedder that installed a host gets a stop. A **standalone** program has
installed no host, `nts_is_owner_thread` is unconditionally true, and a foreign
thread reaches the bridge undetected -- the runtime has no way of its own to
know which thread owns it, and inventing one would be a second answer to a
question the host already owns.

**And a fifth, answered by refusing.** A bridge is a C function pointer: the
caller expects the value back, and the frame below it belongs to `qsort` or
`epoll_wait`. A body that suspends cannot honour that. `hir/native_callback.rs`
refuses one by name, before `suspend::transform` splits it, and the cascade
drops whatever created the bridge.

What the refusal buys is visible with it removed. The compiler emits, happily:

```c
static void NtsBridge_Closure3__call_NtsFn_void_struct_slot_p_int(struct slot *a0, int a1)
static NtsPromise *later(struct slot *v0, double v1)
```

A bridge declared `void` wrapping a body that returns `NtsPromise *`. The
promise is dropped, nothing crashes, nothing is reported, and the callback
never completes. That is the worst of the available outcomes, which is why the
refusal exists before the feature does.

The rule is about the **bridged body**, not its caller: an `async` function
handing C a synchronous callback is ordinary and stays accepted. All three arms
are in `an_async_callback_is_refused_and_an_async_caller_is_not`, and each was
shown to fail when its expectation is flipped.

**What is deferred, and what would settle it.** The question underneath is not
`await` but the microtask it queues while a foreign library's frames are live.
Two answers, both defensible:

| | who drains the queue | cost |
|---|---|---|
| bridge drives it | `nts_checkpoint()` before returning to C | microtasks run with the foreign caller's frames below them, and anything reentering that library is undefined the same way `longjmp` past it is |
| host drives it | an embedder's loop, after the bridge returns | a standalone consumer that never calls back in sees its promises never settle, so the program must call `nts_checkpoint` itself |

Neither is chosen here, because no consumer is asking. `nts_checkpoint` is the
C-embedding API and out of scope besides. When a consumer arrives it will say
which of the two rows it needs, and the refusal names the exact site to change.

## A callback in a struct

`struct sigaction`, every `_ops` table in the kernel headers, and most C
libraries taking more than one callback have this shape: the caller fills
members in and hands the struct over.

    export type Handlers = Struct<{ on_value: (n: c_int) => c_int; fallback: c_int }, "handlers">;
    table.on_value = double;
    dispatch(table, value)

The member is written as an ordinary TypeScript function type, exactly as a
*parameter* is, and is read by the same function -- a function-typed member is
a function pointer for the same reason a function-typed parameter is, and two
answers to that would be two places to keep in agreement. A store into one
becomes the same bridge a call argument gets.

**`Pointee::FnPointer` is the function, not the pointer.** The surrounding
convention is that `NativePointer(P)` spells `P *`, so a member holding a
callback is `Pointer(FnPointer)` and `&p->run` is
`NativePointer(Pointer(FnPointer))`, spelled `NtsFn_int_int *`. Reading the
variant as "the pointer" instead made those two the same type, and the emitted
`v5 = &v0->run` was declared `NtsFn_int_int` and then subscripted. The one
irregularity C does have -- that `int (*)(int)` cannot be written as a spelling
followed by a `*` -- is absorbed in `pointer_type`, which answers with the
typedef and adds nothing.

Two things the witness caught, both the same shape as the prototype it already
checks. The typedef has to be emitted **before** the record that names it, and
was emitted after. And `_Generic` on the member's address was spelled
`NtsFn_int_int *` -- a typedef that exists only in `program.h`, which the
witness must not include -- so it is written out as `int (**)(int)`, the `*`
inside the parentheses where the declarator is.

The fixture's control is `fallback`: `local` zeroes the storage, so with the
member unset `dispatch` returns -1. Removing the store and rebuilding gives
`throughTable(21) = -1` and the caller aborts, which is what makes the 42 mean
something.

## Aggregate copy

    copy(destination, source)

`*destination = *source` -- one whole `T`. An operation and not an assignment,
because there is nowhere to write one: a record member projects as `Ptr<T>` on
purpose, so `p.inner = q.inner` is a pointer assignment and reads like one.

`Ptr` on the destination, `ConstPtr` on the source: C's own `memcpy` signature
minus the size, because the size is the type's and both sides share the type.
Overlap is undefined, as for `memcpy`, and nothing checks it.

    *v2 = *v1;                                                      /* C */
    call void @llvm.memcpy.p0.p0.i64(ptr align 8 %v2, ptr align 8 %v1, i64 32, i1 false)

C's own aggregate assignment rather than a `memcpy` with `sizeof`, because that
size is a number `program.c` already asserts against the C compiler and
restating it would be a second derivation of one fact. LLVM has no struct type
to assign -- every address there is a byte GEP -- so it names the size and the
alignment, both from the same layout.

**A copy retains nothing**, which `native_storage.rs` had to be told: passing a
local's interior to `copy` was an escape, so `copy(b.origin, a.origin)` on stack
storage was refused. Both operands are safe, the *source* included -- which is
what separates it from a store, where the value being written is an address
escaping into the storage it points at.

**The check that makes the fixture a test** is not equality after the copy --
two names for one object are equal. It is changing the source afterwards and
asking the destination: a pointer assignment passes everything before that line
and fails it. Both sabotages were run by changing the emitter and rebuilding:
emitting nothing fails, `memcpy(d, s, 4)` fails, `*d = *s` passes.

One guard here is a control and one is not, checked by probing. *A copy between
two different native types* fires on plain source. *A copy into a `const` native
view* does not -- tsgo answers `TS2345` first -- and is marked in place as
defensive, kept because a `Ptr` can still be built by a cast.

`ConstPtr` also had to learn the projection `Ptr` already made. It gave
`Slot<Pair>` for a nested record where `Ptr` gives `Ptr<Pair>`, so every
`ConstPtr` to a record with a nested record or an inline array was unusable --
and nothing had asked for one until `copy` needed to pass a `Ptr<Sample>` where
a `ConstPtr<Sample>` was wanted.

## Anonymous records

The survey said these block four records where bit-fields block one, so they
came first.

    struct in6_addr { union { uint8_t a[16]; uint32_t b[4]; } __in6_u; };

The member is named and its type is not. C has no spelling for an anonymous
record: no variable may be declared to point at one and `_Generic` cannot ask
about one. A tag invented here would be a second type beside the header's, and
`program.h` includes the header -- verified by inventing one, which gives 11
errors in `program.c` and 10 in the witness.

Nothing marks it. `Naming::Untagged` is inferred -- a record without a tag
written inside a `declare module` that names headers has the header's members,
and the enclosing tag already says so, which is what a marker would have
restated. Every consumer reaches its members by byte offset from the enclosing
record:

    v1 = (char *)&v0->__in6_u;          /* the member has a name */
    v4 = (uint8_t *)((char *)v3 + 0);   /* its type does not */

The same expression the packed path emits, for a different reason: there
because an address may not be *taken* as its own type, here because there is no
type. No definition, forward declaration or `_Generic` is emitted for one; the
*offset* assert stays, because the member has a name even where its type does
not, and what would go wrong shows up in the enclosing record's size.

**`Record` carries one `Naming` rather than three bools.** `foreign`,
`from_header` and `anonymous` had two impossible combinations between them --
`anonymous` implies no tag, and `from_header` was only ever set alongside
`foreign` -- which is four reachable states in eight. Clippy's "more than 3
bools" was right for the reason it usually is not: these were a state, not
independent facts. `packed` stays a bool beside it because it genuinely is
independent.

## Anonymous members

The complementary case, and the opposite answer. C11 6.7.2.1p13 reserves
"anonymous structure or union" for a member with **no declarator** -- the
section above is about a named member whose *type* has no tag, which is a
different rule and was deliberately not given this name.

    struct rusage {
      struct timeval ru_utime;
      __extension__ union { long int ru_maxrss; __syscall_slong_t __ru_maxrss_word; };
      ...

Fourteen of these in a row. The decisive fact is that **C reaches through one**:
its fields are the enclosing record's, so `theirs.ru_maxrss`,
`offsetof(struct rusage, ru_maxrss)` and `_Generic(&p->ru_maxrss, long *: 1)`
are all legal for a member of an anonymous union. Where an untagged *type* has
no spelling in C and forces byte arithmetic, an unnamed *member* has no spelling
in C **and needs none** -- the language already resolves it.

So this needed no compiler work at all. `nts bind-c` splices the members into
the enclosing record and the description is flat:

    ru_maxrss: c_long; // the same bytes as __ru_maxrss_word

Nothing appears on the surface: no marker, no nesting, no name for a thing the
header did not name. Every check generated for an ordinary member -- the offset
assert, the `_Generic` on the field's address, the field access itself -- is C
that compiles unchanged, and `native_witness.c` proves the flat description
against the real header rather than this file asserting it.

**A union contributes only its first member.** A `Member` carries no offset of
its own -- offsets come from the order fields are written -- so two members
cannot share one, and the alternative to dropping the aliases is a surface that
names the same bytes twice. The dropped names are attached to the member that
stands in for them and rendered as a comment. glibc writes the API name first in
every case this has met; where a header does not, the member kept is the wrong
one but never the wrong *bytes*, because a first member that does not reproduce
the union's size makes the generator's recomputed layout disagree with clang's
and the record is refused. Pessimistic about what can be named, never wrong
about what is there.

`examples/interop/native-rusage` is the consumer: `caller.c` lends its own
`struct rusage` to the compiled TypeScript, so both readers see the same bytes.
Its four arms are chosen so that one of them passes even when every anonymous
union is mishandled, and one reads the **last** member of the fourteen, where a
single union described at the wrong size is the only thing that shows.

**A nested reason is merged, not nested.** `record_from` was split into a
`describe` that returns its reasons as a list and a formatter over it. Folding a
recursive call's reasons into one string made `struct tcphdr` report

    `tcphdr` cannot be described, for 1 reason:
      - an unnamed member of type `union ...`: `tcphdr` cannot be described, for 11 reasons:

-- a count of one above twelve bullets, because the count and the list came from
different places. It now reports 11, each marked `through an unnamed member:`
once however deep it was found.

## A program carries the headers it reaches

`program.native_headers` was a scan of the **snapshot**: every `declare module`
carrying `@ntsHeader` contributed, reached or not, and
`runtime/native/libc.d.ts` declares several. It is a scan of the *program* now:

| example | before | after |
|---|---|---|
| `native-stat` | `math stdbool stddef stdint stdlib string sys/stat` | `sys/stat.h` |
| `native-poll` | the same seven, with `poll.h` | `poll.h` |
| `native-rusage` | `math stdlib sys/resource` | `sys/resource.h` |
| `native-callback` | `math stdlib` | none |

**The identity, not a rule about names.** `declares_a_header` walked up to find
the module and returned a `bool`, discarding what it had just located;
`Naming::Tagged` carries that `NodeId` now and `native::Function` carries the
same fact for a call. What a program needs is the union over the records and
calls it actually holds, which is a question about the program rather than a
guess about the snapshot.

**The first attempt guessed, and emptied a check.** It filtered on "does the
program reach this module", decided from node kinds -- a module declaring a type
always contributes, a function-only module contributes when one of its functions
is called. Sixteen examples and every test stayed green. It also made the
witness for a `getpid`-only binding

    extern int getpid(void);          /* and no <unistd.h> */

a prototype compared against nothing, because that binding declares no type and
the function-name match missed. **Nothing observes a check that stopped
checking**, so the rule had to be exact rather than clever.

Both measurements the second attempt owed, taken rather than argued:

- the `getpid`-only binding keeps `<unistd.h>`, which is the case that failed
  before;
- the witness assertion count is **identical** for all eight examples that emit
  one -- 8, 40, 38, 14, 16, 3, 16, 10 -- so nothing that was being checked
  stopped being checked.

**What this does not fix, and was briefly credited with.** A program-level
`let y1 = 3` still fails against `<math.h>` under `-std=gnu11`:
`nts_runtime.h` includes it for every program, whether or not any binding names
a header. Removing the over-inclusion left that error byte for byte. The
examples pin `-std=c11`, which is why nothing had seen it. The `RUSAGE_SELF`
collision is the one this *does* narrow: a module-level `const` is emitted into
the translation unit that includes the headers a binding names, and there are
fewer of them now.

## Bit-fields

`struct iphdr` refused for two of them, and now describes. The surface spells
one `Bits<T, N>`:

```ts
ihl: Bits<c_uint, 4>;
version: Bits<c_uint, 4>;
```

and projects it as a plain `number` -- deliberately **without** the `__c_of`
phantom every other member carries. That phantom is the only thing `addrOf`
reads, so `addrOf(h.ihl)` is a *type error* rather than a diagnostic, which is
what C says too: a bit-field has no address and `&p->ihl` does not compile.
The surface cannot express what C forbids, instead of expressing it and
refusing it a pass later.

**The allocation rule is read from clang, not from the ABI document.** Three
probe structs separate cases the document states together:

| written | clang says |
|---|---|
| `unsigned int a : 3; unsigned int b : 7;` | `0:0-2` `0:3-9` |
| `unsigned int a : 30; unsigned int b : 5;` | `0:0-29` `4:0-4` |
| `unsigned char p : 6; unsigned int q : 30;` | `0:0-5` `4:0-29` |

The first says a bit-field simply continues where the last ended, across a byte
boundary -- clang prints the end past 7 rather than starting a new byte. The
second and third say when it does *not*: a field is bumped to the next multiple
of its own unit's width whenever staying put would straddle one. The third is
the discriminating pair, because the unit that decides the bump belongs to the
**arriving** field, not to the one before it.

**A fourth test exists because the first four all passed a wrong compiler.**
Hard-coding the unit width to 32 bits left every one of them green: in each, a
32-bit assumption and the field's real unit happen to bump at the same place.
`unsigned char a : 6; unsigned char b : 5;` is where they part -- an 8-bit unit
has no room at bit 6 and bumps to bit 8, a 32-bit one would not. Four tests
whose names claimed to check the unit and none that did.

**`NativeBitLoad` and `NativeBitStore`, not an address and a load.** `&p->ihl`
is not an expression C has, so an HIR that produced one could only be emitted by
a backend that fused the pair back together and hoped nothing had come between
them. The model says the true thing: there is no address here, so no op makes
one, and `Place::NativeBits` carries the record's pointer and the member's index
instead.

### What checks it, and what cannot

`offsetof` and `_Generic(&...)` are **both illegal** on a bit-field, so the
witness emits neither. `sizeof` and `_Alignof` remain, and a misallocated run
changes the size of the record holding it -- but not always: `ihl` widened from
4 bits to 8 leaves `struct iphdr` 20 bytes, so the static check does not see it.

Worse, **the C backend cannot see it either.** It emits `h->version` and lets
`<netinet/ip.h>` decide where the bits are, so a width this binding gets wrong
produces a correct read anyway. The claim is invisible to the whole C lane.

The LLVM backend is what makes it load-bearing. It has no C compiler to defer
to, so it shifts and masks using the positions `hir::layout` computed:

```llvm
%v1.raw = load i32, ptr %v1.unit
%v1.sh  = lshr i32 %v1.raw, 4
%v1     = and i32 %v1.sh, 15
```

So `a_bit_field_reads_and_writes_the_same_bits_on_c_and_llvm` is two
*independent derivations* of one layout compared by running both, rather than
one derivation checked against itself. Its `caller.c` fills a real `struct
iphdr` and asserts what each backend reports; both answer `version=4 ihl=5` and,
after `setVersion(6)`, byte 0 is `0x65` -- the neighbour intact, which is the
arm a clear-mask one bit wide in the wrong place fails. Sabotaging the shift by
one and the mask by one bit each fail it.

### Packed

`__attribute__((packed))` removes both roundings, and the bit one is the less
obvious. Read off clang the same way:

```text
packed:  unsigned int x : 30;  unsigned int y : 5;      0:0-29  3:6-10
packed:  unsigned char p : 6;  unsigned int  q : 30;    0:0-5   0:6-35
packed:  unsigned int m : 4;   unsigned char n;         0:0-3   1
```

A packed bit-field is **never** bumped, so `y` continues at absolute bit 30
rather than starting a fifth byte, and `q` ends at bit 35 -- four bits past the
32-bit unit it is declared in.

**That is what made the LLVM backend load the wrong bits.** It read "the storage
unit containing the field", which is sound only while the allocator guarantees
no field straddles one. It now loads exactly the bytes the field occupies --
`load i40, ptr %p, align 1` for `q` -- which is also narrower for the unpacked
case and never reads past the record's end. Reverting to the unit load fails the
packed arm of the agreement test and nothing else.

Two defects found by running the first packed fixture, neither about packing:

- **The emitted struct dropped the `: width`.** A record the program *invents*
  is defined in `program.c` rather than included, and the definition said
  `uint8_t p; unsigned int q;`. Packed, that is five bytes -- and so is the
  correct `uint8_t p : 6; unsigned int q : 30;` -- so `_Static_assert(sizeof ==
  5)` passed over a struct whose members are in entirely different places. A
  header-defined record was never affected, which is why `struct iphdr` was
  right while this was wrong.
- **`local<Flags>()` was refused as an escape.** `native_storage`'s borrow
  analysis knew every native op except the two new ones, so a bit-field read
  reached it as an unrecognised use of the pointer. There is no address of a
  bit-field to store anywhere, which is the whole reason they are their own ops.

## Flexible array members

`struct cmsghdr` ends in `unsigned char __cmsg_data[]`. The member has **no
extent**: the struct is 16 bytes and `offsetof(struct cmsghdr, __cmsg_data)` is
also 16, so it begins exactly where the record ends. It is placed at its
element's alignment and raises the record's, which `struct { char c; long l[]; }`
shows -- `l` at 8, size 8, align 8 -- and contributes no bytes of its own.

`Flexible<T>` on the surface, and reading it gives a `Ptr<T>`: the decay C
performs, and the only thing C offers, there being no extent to copy and no
whole value to load. `caller.c` asserts the address this compiler reaches is the
one `CMSG_DATA` computes, which is the platform's own answer.

**The count is nowhere.** For `cmsghdr` it is `cmsg_len` minus the header;
elsewhere it is another member, an argument, or a protocol. No header states it
and this compiler does not invent one, so nothing bounds a read through a
flexible member -- the same footing as every other native pointer here.

Distinct from `Array { length: 0 }`, which lays out identically and spells
differently: C writes `T name[]`, a zero-length array is a GNU extension, and
`_Generic` wants `T (*)[]` against `T (*)[0]`. A count of zero on the surface
would also be a claim -- that there are none -- where the truth is that the
count is not in the type.

**Every check the witness already emits works on one**, which was verified
against the real header before any of it was written: `sizeof`, `offsetof` and
`_Generic(&p->__cmsg_data, unsigned char (*)[])` are all legal C for a flexible
array member. So it is checked like any other member rather than exempted.

Giving the member an extent fails the agreement test on both backends, which is
the control: every read after it lands past the payload.

## A record C names only by a typedef

`__sigset_t` is `typedef struct { unsigned long __val[16]; } __sigset_t;` -- a
struct with **no tag**. C spells the type `__sigset_t`, and `struct __sigset_t`
is a *different*, incomplete type the header never defines. Everything else
about it is an ordinary header record: `sizeof`, `offsetof` and `_Generic` all
work, and only the keyword that is not written separates it.

    Typedef<Struct<{ __val: CArray<c_ulong, 16> }, "__sigset_t">>

**A wrapper rather than a third argument**, for the reason `Packed<T>` is one:
it says a thing about the whole record, and a positional flag in a tag slot
reads as part of the name.

**It is the one thing here that could not be inferred**, which is worth stating
because every other marker was removed for being inferable. Nothing in
`Struct<{...}, "__sigset_t">` says which of the two the header wrote, and this
compiler does not read headers -- the generator does, and a hand-written binding
has to be able to say it too. Three spellings were considered; the one that
needed no new vocabulary turned out not to work for exactly this reason.

Four places spell a record's C name and each had to ask: `Pointee::c_type`, the
witness's assertions, `program.c`'s own layout asserts, and the **forward
declaration** -- which is skipped entirely, because `__sigset_t;` is not a
declaration and `struct __sigset_t;` declares the wrong type.

`nts bind-c` derives one. Its layout probe spells it bare too, and
`parse_layouts` accepts clang's bare dump line: a tagged record prints as
`struct rusage` and a typedef-named one prints as `__sigset_t`, with no keyword,
because there is no tag to print.

**The survey is 26 of 26.** `sigaction` was the last, and it needed three things
that arrived separately -- the anonymous union lifted, the function-pointer
members described, and this.

`caller.c` includes the real `<signal.h>` beside `program.h` and asks the same
question twice, through libc and through the compiled TypeScript. Putting the
keyword back fails it, and so does an unemptied set: a signal that was never
added must not be a member, which is the arm that passes over a set saying yes
to everything.

### A prototype check needs the header to declare the symbol first

**Found 2026-09-15 by building the control rather than by reading the code**,
and closed the same day. Re-declaring a function is how the witness checks a
prototype: `extern int fsync(void);` against glibc's `fsync(int)` is

    error: conflicting types for 'fsync'
    /usr/include/unistd.h:989:12: note: previous declaration is here

which is the check working. But it only works when the header declares the
symbol **at all**. Name the wrong header and there is nothing to conflict with
— our `extern` is simply a new declaration, and clang is happy:

    @ntsHeader stdio.h   #include <stdio.h>
                         extern int getpid(void);
                         -Wall -Wextra -Werror: clean

Zero diagnostics, a witness that compiles, and a prototype compared against
nothing. It is the same hazard this section's over-inclusion work was about —
"a getpid-only binding lost `<unistd.h>` and compared a prototype against
nothing" — reached from the other side: not a *missing* header but a *wrong*
one. A check whose answer cannot depend on its input is not a check.

The fix is one line, and where it goes is the whole of it:

    _Static_assert(sizeof(&getpid) > 0, "a named header declares getpid");
    extern int getpid(void);

`sizeof(&f)` needs `f` to be a declared identifier and evaluates nothing, so it
fails exactly when the named headers do not declare the symbol. It must sit
**above** the `extern`, because that line would otherwise supply the very
declaration the probe is looking for and the check would pass under any header
in the world — the same ordering trap as a feature probe written below its
first use.

Both arms verified against real headers: `unistd.h` compiles clean, `stdio.h`
now gives `error: use of undeclared identifier 'getpid'`.

**Only where a header was named**, which is the precondition and not a detail.
`c-from-ts` declares its own C in a module carrying no `@ntsHeader` at all;
there the `extern` is a self-sufficient declaration rather than a claim about
somebody else's header, and there is nothing for a probe to look in. Probing
those would fail every one of them for having no header, which is not a
disagreement about anything. `Function::declared_at` is the same provenance the
record assertions already filter on — the machinery item (d) added for
reachability, answering a second question.

**And it immediately found one in the tree.** `native-epoll` declared

    export function close(fd: c_int): c_int;

inside a module whose only `@ntsHeader` was `sys/epoll.h`. `close` is declared
by `<unistd.h>`. The prototype was emitted, compiled, and checked against
nothing — and happened to be right. The module names both headers now, which it
always needed to. Swept across all sixteen interop examples: one real
misattribution, and three apparent failures that were the sweep's own missing
`-I`, confirmed by running the **old** binary against the same command and
getting the identical output.

**Safe on this population, checked rather than assumed.** All 29 libc entry
points these bindings reach compile clean under `-Wall -Wextra -Werror`,
including `ceil`, `floor`, `fabs`, `fabsf`, `copysign` and `ldexp` — the ones a
header may define as a macro, which is the case that would have made `&f`
ill-formed. 59 test suites pass unchanged.

### The witness asserts about a header's records, not about every tag

Found while writing the packed fixture and **older than bit-fields**: a tag the
declaration authored *without naming a header* produced a witness that could not
compile.

    error: invalid application of 'sizeof' to an incomplete type 'struct pair'

`foreign()` is true of any tagged record and `from_header()` only of one a named
header defines. The witness filtered on the first, so it asserted about a type
nothing in that file defines. No example reached it because every example that
authors a tag also names the header it came from.

The witness filters on `from_header()` now. Nothing was lost by it, which was
measured rather than assumed: the assertion count is **identical** for all eight
examples that emit one -- 8, 40, 38, 14, 16, 3, 16, 10 before and after. What it
drops is a file that never compiled, and for those records `program.c` still
asserts size and offsets against its own definition, which is the only claim
there is to make.

### The hand-written ABI is deleted for the chosen example

`examples/interop/native-poll/types/poll.d.ts` is **generated**, by that
example's own `bind.sh`. The file it replaced was written by hand and the two
are the same binding: identical types, identical contract, differing only in a
parameter *name*, which the generated one takes from the header (`nfds`) where
the author had chosen `count`.

The hand-written file carried this, which is why it was worth writing:

> `events` and `revents` are `short`, and a binding calling them `int` has the
> right size and the wrong struct.

True, load-bearing, and now something a tool reads rather than something a
person remembers.

The one thing that did **not** transfer is `@ntsNoEscape fds`, which is in the
command rather than in the file, because a C signature cannot state it and this
tool will not invent it. Without it the compiler refuses `local<PollFd>()` as an
escape -- correctly -- which is what makes the flag a claim and not a
formality.

### What blocks real headers, counted

Twenty-six POSIX records, asked for one at a time, **through `nts bind-c`** --
so this counts what can be *derived from a header*, not what the compiler can
describe. **All twenty-six work**, nineteen when the survey was first run, and
each one that changed is the reason a part of this section exists.

That the number reached 26 is not a claim that every C record describes -- it is
a claim about *these* records, chosen before the work rather than after it, and
the population is written out below for that reason. A survey that grew to fit
its answer would report the same number and mean nothing.

| cause | records | |
|---|---|---|
| an **anonymous** record as a *named member's type* | `sockaddr_in6`, `in6_addr` | described |
| an **unnamed member**, whose fields C reaches as the enclosing record's | `rusage` | described |
| a bit-field | `iphdr`, `tcphdr` | described |
| a flexible array member (`unsigned char[]`, no length) | `cmsghdr` | described |
| a typedef naming an **unnamed struct** (`__sigset_t`) | `sigaction` | described |

`tcphdr` and `sigaction` both moved rows without anything being done to them,
which is the part worth reading. Each had been filed under the first thing that
stopped the walk. `tcphdr` reported an unnamed member and nothing past it;
reaching through finds eleven bit-fields, and it describes now that both are
handled -- so its recorded cause was wrong twice over, and neither time was the
record actually harder than the ones beside it. `sigaction` reported an anonymous
union; resolving that reaches `__sigset_t`, which is a typedef of a struct with
no tag -- a third shape, and the one this survey had never produced. **A cause
recorded from a walk that stops is the cause of the stop, not of the refusal**,
and both entries read as naming problems for as long as nothing looked past the
first one.
`sigaction`'s refusal said *these headers define no complete `__sigset_t`* --
which is what the code could tell, and not what is true. `__sigset_t` is
`typedef struct { unsigned long __val[16]; } __sigset_t;`, and clang gives an
unnamed record a **typedef name for linkage**, so the member's type reports as
`struct __sigset_t` while no tag of that name exists in the parse. The two are
told apart by the id on the typedef's `RecordType`, which names a `RecordDecl`
that is complete and unnamed -- matched by id rather than by position, because
the parse is walked depth-first and a record's own fields sit between it and the
typedef that follows it. The message now says which of the two it is.

Describing one is a separate question and deliberately not answered. C *does*
give this type a spelling, unlike the untagged member type above, so `sizeof`,
`_Generic` and a declaration would all work -- the only obstacle is that the
surface names a record by its tag and this type has none. That wants a way to
say "spelled without `struct`": new surface vocabulary, for one record in
twenty-six. Refused by name, with the reason, until something asks.

**A generated binding is re-derived by the build that uses it.** Each
`build.sh` runs its example's `bind.sh` into a scratch file and compares. A
generated file nothing regenerates is *asserted*, not checked: if `nts bind-c`
changed what it emits, or the headers moved, the committed file would go stale
in silence and only a **wrong** binding would be caught, by the witness. This
catches a stale one too, and the message names the script to run.

Verified by making one stale -- `revents` as `c_int32` -- which exits 1. The
first attempt at that control changed nothing, because the `sed` pattern had
six spaces of indentation where the file has four, so the check was tested
against an input that had not moved and read as working.

**A refusal reports every reason, not the first.** That is how `sigaction` was
filed for weeks as a function-pointer case: the mapper stopped at
`void (*)(void)` for `sa_restorer` and never reached the anonymous union
behind it, which is the actual blocker. Function-pointer members got built --
useful work, done for a wrong reason -- and the record still refused. `iphdr`
now reports both of its bit-fields rather than one.

The set counted is `stat`, `tm`, `timeval`, `itimerval`, `sockaddr_in`,
`sockaddr_in6`, `in6_addr`, `msghdr`, `cmsghdr`, `dirent`, `rlimit`, `rusage`,
`statvfs`, `iovec`, `addrinfo`, `hostent`, `epoll_event`, `passwd`, `group`,
`utsname`, `pollfd`, `tcphdr`, `iphdr`, `sched_param`, `sockaddr_un`,
`sigaction` -- written out because the first run of this survey and the second
used slightly different sets, and a count whose population is not stated is a
number two people will read differently.

Anonymous records read as blocking **five times** what bit-fields do, and that
count is why they came first: a gap list written from the C standard's table of
contents ranks by what C *has*, and this ranks by what these headers *use*. The
ranking was right and **the count was not**. Of its five, `tcphdr` is a
bit-field record and `sigaction` a typedef-of-an-unnamed-struct record; each had
been filed under the first thing that stopped the walk. The real margin was 3 to
2, not 5 to 1.

That is worth keeping rather than quietly fixing. A survey that records the
first refusal per record ranks **causes of stops**, and a record with several
blockers is counted entirely against whichever one the walk happens to reach
first. The margin it reported was three times the real one, and the only reason
the decision survived is that the true margin pointed the same way.

All four are described now, and the split between them is a real difference in
C rather than in this tool -- one that turned out to decide how much work each
needed. A **named member whose type is anonymous** -- `union { ... } __in6_u;`
-- is reached as `p->__in6_u.field`, so only its *type* is unnameable, and every
consumer of one has to reach its members by byte offset because C offers no
other way. An **unnamed member** is reached as `p->field`, as though its fields
belonged to the enclosing record -- and that is C resolving it, not something
this surface has to reproduce. The first needed a lowering path; the second
needed the binding to stop insisting on a name, and nothing else.

Twenty-six of twenty-six now, and **no record in this survey refuses for a
naming reason any more**. The two that were counted here belonged elsewhere:
`tcphdr` to bit-fields and `sigaction` to a typedef of an unnamed struct, each
filed under the first thing that stopped the walk rather than under what it
needed.

The three shapes are now separated by what C offers, which is what decides the
work each needs. A **tag** is spelled with its keyword. A **typedef name** is
spelled without one, and `Typedef<T>` says so because nothing else can. An
**unnamed record** has no spelling at all, and every consumer of one reaches its
members by byte offset -- the only case of the three that needed a lowering
path rather than a way to write the name.

### What it refuses, surveyed against real headers

Fifteen POSIX records, asked for one at a time, all under `_GNU_SOURCE`. The
survey is the instrument: each refusal is either a gap or a missing mapping, and
guessing which headers to try would have found neither of the two it did.
`rusage`, `tcphdr` and `iphdr` were added to the original twelve because the
goal names anonymous members and bit-fields, and a population that excludes the
records those appear in cannot measure either.

| | before | now |
|---|---|---|
| `stat`, `tm`, `timeval`, `sockaddr`, `msghdr`, `dirent`, `rlimit`, `statvfs`, `iovec`, `addrinfo` | described | described |
| `termios` | an unnamed member, also an anonymous union | **described** |
| `rusage` | an unnamed member, fourteen times over | **described** |
| `sigaction` | *an anonymous union*, which has no tag to name | no complete `__sigset_t` |
| `tcphdr` | an unnamed member -- and nothing past it | 11 bit-fields, which is its real blocker |
| `iphdr` | 2 bit-fields | 2 bit-fields |

**12 of 15 described, and the three remaining are two causes, neither of them
anonymous members.** Bit-fields block `tcphdr` and `iphdr`, and are refused by
name in both directions rather than described.

`sigaction`'s blocker moved to a shape this survey had not produced before: a
**typedef naming an unnamed struct**. `__sigset_t` is
`typedef struct { unsigned long __val[16]; } __sigset_t;` -- there is no
`RecordDecl` of that name to find, only a `TypedefDecl` whose underlying type is
anonymous. That is a third case beside the two above, and it is recorded rather
than guessed at: the earlier entry said "an anonymous union, which has no tag to
name", which was true of the record it stopped at and not the reason it refuses
today.

`tcphdr` is the one that shows the survey working as an instrument. It reported
one unnamed member and nothing else, because the walk stopped there. Reaching
through it finds an anonymous union of anonymous structs and, inside those, eleven
bit-fields -- so the entry that read like a naming problem was a bit-field
problem all along, and no work on naming would have moved it.

The function-pointer member that refused first is described now, because the
compiler describes one: `int (*)(int)` is read as `(arg0: c_int) => c_int`, and
the parameter list is split on *top-level* commas only, since a parameter may
itself be a function pointer.

**A typedef reached through an array had nothing to fall back on.**
`desugaredQualType` is absent for an array type, so `cc_t[32]` and
`__syscall_slong_t[3]` carried no desugared form at all and `struct termios`
and `struct stat` were both refused for a typedef the same parse had already
resolved. The fix is the parse's own typedef table -- 137 entries for two
headers -- resolved one hop at a time.

**A nested record is pulled in, not demanded.** `struct sockaddr_in` holds a
`struct in_addr` and `struct stat` holds three `struct timespec`s; their
layouts *are* part of the outer layout, so asking for them separately was
bookkeeping the tool can do. Repeated until it settles, because a nested record
may nest.

## Constants, which no binding can carry

`EPOLLIN` is an enumerator, `EPOLL_CTL_ADD` a macro, `O_CREAT | O_WRONLY` an
expression of macros. None is a declaration, so no `.d.ts` can name one, and
three examples here typed the number by hand and asserted it from C.

    nts bind-c --module c:epoll --header sys/epoll.h \
      --const EPOLLIN:c_uint32 --alias EPOLLIN=READABLE \
      --const EPOLL_CTL_ADD --constants-out src/constants.ts

The values come from the compiler's own evaluator. Each requested name goes
through an enumerator in a probe translation unit --

    enum nts_bind_constants { nts_k_EPOLLIN = (EPOLLIN), ... };

-- which is the one place C guarantees a constant expression is evaluated and
reported, so a macro, an enumerator and `O_CREAT | O_WRONLY` all arrive as one
integer. The brand is the author's claim, as everything else in a binding is,
and defaults to `c_int`.

**A second file, and a `.ts`.** A declaration file cannot carry a value:
`declare const EPOLLIN: c_int` gives the compiler nothing to fold. The binding
and the constants are two files because they are two things.

**A name the headers *declare* is refused, with the remedy.** `program.c`
includes what a binding names, so a global here lands beside everything those
headers declare. A macro collision is already handled -- program.c releases each
of its own names from whatever macro bound it -- but nothing releases a
declaration, and `EPOLLIN` is an enumerator. The tool can see which it is, so it
says so and names the flag: `--alias EPOLLIN=READABLE`.

`examples/interop/native-epoll` now imports its two values from a generated
`src/constants.ts`, regenerated by its own `bind.sh`. The C-side assertions
stay, and what they check has changed: not that someone copied two numbers
correctly, but that the generated file is current. Verified by making it stale
-- `READABLE = 4` -- and watching the caller abort.

## Variadics

`int open(const char *, int, ...)` cannot be reached without them: with
`O_CREAT` the third argument is required, and one C declaration covers both
arities. A TypeScript rest parameter is the same statement and needs no tag --
`native::Function` gains `variadic: Option<Type>`, set from a trailing rest
parameter.

**A type where C has none, deliberately.** The prototype constrains nothing
after the comma; the binding constrains everything. A variadic argument's type
is not recoverable from the callee, so it has to come from somewhere, and a
declaration is the only place that can be checked. Two shapes of `ioctl` are
two declared names.

**The tail is arguments, not a rest array.** TypeScript gathers a rest
parameter into one value, and doing that to `open` handed C the address of an
empty `NtsArray` cast to `uint32_t` -- a call that compiled, linked and was
wrong. `lower_native_arguments` skips the gather and gives each argument the
tail's declared type.

**What C promotes, a binding may not name.** The default argument promotions
(6.5.2.2p6) apply past the last declared parameter, so a tail of `uint16_t` or
`float` describes something nobody passes. Refused, with the promoted type
named -- `declare `int`` rather than a diagnostic that leaves the author
guessing.

Two neighbouring guards -- a rest parameter that is not last, and one whose
type is not an array -- are unreachable from TypeScript source, checked by
probing: tsgo reports TS1014 and TS2370 first. They stay because the input is a
snapshot rather than the source, and they are marked in place as *not* controls,
because nothing this lane writes can make them fire.

`examples/interop/native-open` runs on both backends. Its control is the file's
**permission bits**, not its contents: a call that dropped the third argument
still creates the file -- with `01650`, tried -- and reading the byte back
passes.

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

**Retained callbacks, and what their protocol actually is.** A retained
callback is called after the registering call returns, so its context must
outlive that frame. `native-callback` subscribes, drives two events through
`deliver`, unsubscribes, reads the accumulated total and frees:

    local context     refused  -- "native local address escapes"
    heap context      accepted
    @ntsNoEscape ctx  accepted with a local, because then it is not retained

No new machinery was needed. The contract for a retained parameter is
`Unknown` -- the *absence* of `@ntsNoEscape` -- and that is exactly what refuses
the local. The local-address check reaching through a callback, rather than a
rule written for one.

**What the compiler proves here, and what it does not.** It proves the context
is not a frame that has gone. It proves nothing about the heap one: freeing it
while still subscribed is a use-after-free like any other, and pairing
`subscribe` with `unsubscribe` is the caller's obligation. `unsubscribe` is the
defined event after which the library calls neither the callback nor the context
again, and that is what makes the free safe -- a fact the binding states and
nothing checks. Proving the pairing is ResourceFlow's job and it is not built.

The bridge and the closure singleton are immortal, so nothing about the
*callable* needs releasing; the whole lifetime question is the context's.

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
