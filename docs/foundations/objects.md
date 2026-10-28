# Objects, arrays and functions

How objects, classes, arrays, functions as values and dynamic values are
represented on native (C and LLVM), and what a field access, a method call and
an element read cost. For compiler and runtime work. What these mean in the
language (types as layouts, casts, `any` and `unknown`, interfaces by shape)
is [language/types.md](../language/types.md); closures and `this` are
[language/functions.md](../language/functions.md). `Map`, `Set` and objects
used as dictionaries are [hashing](hashing.md); strings are
[strings](strings.md); when storage is freed is [memory](memory.md).

## The header and the descriptor

Every managed object, array and string starts with one **header**
(`NtsHeader`, 24 bytes):

| field | holds |
|---|---|
| `descriptor` | the object's descriptor: its type at run time |
| `reserved` | the memory provider's word: the reference count under counting, unused otherwise |
| `flags` | per-object bits, such as a string's width, whether it has grown or been hashed, and an immutable array |
| `length` | for arrays and strings, the element count |

With the allocator's own bookkeeping, 40 bytes precede an object's first
field. A 16-byte header is planned, measured separately
([memory](memory.md)).

A **descriptor** (`NtsDescriptor`) is emitted by the compiler, one per layout,
read-only. It holds the object's kind and size; the byte offsets of its
reference fields, for counting and tracing; whether the type can be part of a
reference cycle, which the compiler proves per type and which keeps the cycle
collector away from types that cannot; the method table; the name; where its
tagged values and counted foreign objects are; an array's element kind; how
the object prints; and a function's `name`. An absent entry means *refuse*,
never a guess: a type nobody taught to print stops by name rather than
printing `[object Object]`.

## Classes

**One fixed layout per class,** and per object-literal shape and closure
class. `hir::layout` places the fields by the platform C ABI's rule for a
struct (each field at the next multiple of its alignment), so the C and LLVM
backends read one answer; the C backend checks every offset against clang with
a `_Static_assert`. Structurally identical layouts are merged; `nts layouts`
prints the result ([cli](../reference/cli.md#inspecting)).

- **Base first.** A subclass's layout begins with its base's fields, so a
  pointer to the subclass is a pointer to the base and an upcast costs
  nothing. Two layouts share a field's storage exactly when they agree up to
  and including it, which makes aliasing through a base pointer exact and
  cheap to reason about.
- **Fields have their proved width.** A field holds the join of every store
  the program makes into it, so a numeric field is an integer where every
  store proves one ([numbers](numbers.md#integers-proved-from-doubles)). A
  field code outside the program can write keeps its declared width.
- **A field access is one load or store at a fixed offset** wherever the
  object's class is known, or every class that can arrive holds the field at
  the same offset.
- **`x instanceof C`** compares the descriptor once per class in `C`'s
  hierarchy, which is closed: a compiled program gains no subclasses, so
  there is no chain to walk. *Designed, not built:* a single class-id range
  test.
- **Not represented:** prototypes as values, property descriptors, properties
  added at run time ([language/boundaries.md](../language/boundaries.md)).
  `Object.freeze`, `seal` and `preventExtensions`, `Proxy` with `Reflect`, and
  `globalThis` are in scope and deferred, each to cost nothing where a program
  does not use it (L24–L26 in [open questions](../open-questions.md)).
- *Designed, not built:* nullable fields.

## Interfaces satisfied by shape

A class satisfies an interface by having its members; `implements` is optional.
Before it numbers dispatch slots, the compiler infers every class-to-interface
edge for the whole program (`infer_implements`). Each interface method gets a
slot, and every class that fits fills it. An edge for a class no value ever
brings to the interface fills a row nothing reads, and is harmless.

**Methods through an interface** are one indexed load from the descriptor's
method table and an indirect call, the same as a virtual call. Where a class's
method is specialized differently from the interface's signature (an `int32`
result where the interface says `number`), its row is an adapter. On native
the tables keep only the columns some call reads (`hir::native_dispatch`), and
descriptors with identical rows share one table.

**Fields through an interface:**

- **Direct** where the object's class is known, or where every class that can
  arrive keeps the field where the interface's own layout does. A function
  taking an interface and called with a known class is copied for that class,
  so its accesses are direct (record 0294).
- **Otherwise a field family:** each class that keeps the field elsewhere gets
  a row in the slot (a getter, and a setter where the interface is writable);
  every other object takes the slot's default, the interface's positional read.
  A lookup is two null tests (`nts_family_row`), then a call. A layout that has
  no such member at all takes a named stop.
- **A small set is tested instead:** where at most two classes move the field,
  the access tests for each and calls its row directly, which the C compiler
  can inline (`hir::small_dispatch`). Past two, the table: one load at any size.

The JVM writes the inferred `implements` into each class file and calls through
`invokeinterface`; field families on the JVM are declined by name (`NTS4001`)
until its stateful interfaces exist. Wasm, by design, dispatches through
typed references.
The design, its measurements and its alternatives (Go's itabs, Java's
itables) are in [the interfaces notebook](../records/notebooks/interfaces-by-shape.md).

## Calls

| call | how | cost |
|---|---|---|
| a function, or a method nothing overrides | direct | a call the C compiler can inline |
| a method some subclass overrides | through the descriptor's method table | two dependent loads and an indirect call |
| through a function value or an overridden method, where the whole program proves the receiver is one of at most two classes | a test per class, then a direct call each (`hir::class_sets`) | a compare and a predictable branch per class; the bodies can inline, and arguments can stay borrowed across the call |
| a function handed a closure | cloned per closure class it is handed, up to ten clones (`hir::monomorphize`) | inside the clone the call is direct |
| a generic function | one copy per instantiation | no erased fallback exists (L9) |

Where nothing is overridden and no interface slot is read, a class's
descriptor has no method table and its methods are plain functions. Where a
dispatch stays indirect, every implementation of the slot is entered through
one signature, so implementations that disagree about a parameter's
representation are refused rather than called at the wrong one
(`hir::dispatch`).

## Arrays

An array (`NtsArray`) is a header, a capacity, a pointer to its elements, and
padding that keeps its size a multiple of 16. The elements sit **inline**,
right after the header, until the array first grows; then they move to a block
of their own. The pointer is loop-invariant, so the C compiler hoists its load.
**Every element block starts on a 32-byte boundary,** one AVX2 register.

**Element kinds.** The descriptor says what a slot holds: a reference, a
16-byte tagged value, a float (4 or 8 bytes), a signed or unsigned integer, a
boolean, a counted foreign object, or an unboxed 128-bit bigint. `number[]` is
an array of doubles unless every array of that element type in the program is
proved to hold integers, when it is `int32_t` or `int64_t` (`hir::elements`).

**Reads and writes:**

- **A bounds check unless it is proved away** (`hir::bounds`): by a known
  length, or by an index the same array's length guards, which is a relation
  rather than a range: `for (i = 0; i < xs.length; i++)`. An unproved check is
  a compare and a branch, inline.
- **A read out of range stops by name** today, where JavaScript answers
  `undefined`; by the bounds rule it is to give `undefined`
  ([Decisions](#decisions)).
- **A write at `length` appends** to an array of numbers or other uncounted
  elements, with growth behind a call; a write further out stops by name,
  since a hole has no representation in a dense array. An array of references
  or counted objects does not grow by index, because counting reads a slot's
  old value before it stores; it grows through `push`.
- **A hole in an array of numbers reads as 0** on C and LLVM, a recorded wrong
  answer (`tests/outcomes/a-hole-in-an-array-of-numbers-reads-as-zero`). A
  reserved NaN marking holes is proposed (X1 in
  [the JVM and Wasm](jvm-and-wasm.md)).
- **Tuples** of mixed element types are laid out as structs, and
  `Array.isArray` is true of them.

Storing through a covariant array alias (a `Sub[]` seen as a `Base[]`) is
decided: an array's narrow storage will need a proof that every writer stores
the narrow type, as a `Map`'s and a `Set`'s contents do
([types](../language/types.md#decisions)).

### Typed arrays

| type | representation |
|---|---|
| `ArrayBuffer` | a byte length and the bytes, in aligned storage |
| `Int8Array`, `Uint8Array`, `Int16Array`, `Uint16Array`, `Int32Array`, `Uint32Array`, `Float32Array`, `Float64Array` | a view: a window onto a buffer, read and written at its element's width |
| `ArrayBufferView` | a view whose element type the declaration does not say: `byteLength`, `byteOffset` and `buffer` work, and it can be handed to native code; an indexed read is refused |
| `DataView` | a window with no element type: the width and endianness are chosen per access |

- **Views alias:** every view of one buffer reads the same bytes. `subarray`
  shares the buffer; `slice` copies into a new one. A view made without a
  length follows its buffer through a resize, and a detached view has length
  0, so every index is out of range.
- **A class extending a typed array** (`class Bytes extends Uint8Array {}`)
  is that view: `new Bytes(8)` builds one.
- **Not provided:** `Uint8ClampedArray` (its clamping store is a different
  operation), `Float16Array`, `BigInt64Array`, `BigUint64Array`.
- Native code loads any width at any offset. A backend whose arrays are typed
  (Wasm GC) can store a view's elements at their own type where it is proved
  that nothing else sees the bytes (`hir::views`).

## Functions as values

**A closure is an object with one method.** Its captured state is its fields,
laid out base first with the function's signature type, which has no fields,
as the base: a closure pointer is a signature pointer. It therefore gets every
object mechanism as written: escape analysis keeps a closure that does not
outlive its call in the frame, with no allocation, and counting treats it as
any object.

- **Captures.** A variable nothing writes is copied into the closure. A
  variable something writes moves into a cell, and the closure holds the cell,
  which is JavaScript's capture by reference. A per-iteration `let` that a
  closure captures and the loop writes is refused by name, since one cell
  would give every closure the loop's last value.
- **Two entries per closure class:** its own `call`, at the signature's types,
  and a uniform entry whose parameters and result are tagged values and which
  takes the call's `this`. A call that knows only the signature uses the
  uniform entry; one where the class becomes known is turned into a direct
  call.
- **The call costs** what the [calls](#calls) table says: direct where the
  closure's class is known, a test per class for two, otherwise an indirect
  call through the shared slot.
- *Designed, not built:* class sets carried through fields and return values,
  splitting call sites, typed adapters.

## Dynamic values

A value whose type is decided at run time (`any`, `unknown`, a union of
unlike representations) is a 16-byte **tagged value** (`NtsValue`): a 32-bit
tag and an 8-byte payload holding a double, a boolean or a reference.

- **The tags are `typeof`'s answers:** `undefined`, `boolean`, `number`,
  `string`, `function`, `symbol`, `object`, `null`, `bigint` (in an owned box),
  and a block of eight for foreign objects (GObject, Objective-C, COM, a host's
  objects), which answer `"object"`. Reading the tag is `typeof`, and
  `typeof x === "object"` is one range test.
- **A union that a pointer can carry stays a pointer:** `T | null` and
  `T | undefined` are a pointer with one absent value. `null` and `undefined`
  together need the tagged form, since they are different values.
- **A member read on an erased value by a key known only at run time** is
  refused today. It is decided to go through a table of member names per type,
  found through the value's run-time descriptor, while typed code stays direct
  ([types](../language/types.md#decisions)). Untyped JSON needs a new
  representation for it, designed with JSON.

## Objects at an exported boundary

Record 0356 decides how an object crosses an exported boundary (a Node addon's
entry, a Wasm module's glue): copied in where the copy cannot be noticed, a
live reference to the caller's object otherwise, a cached wrapper for an
object nts made, borrowed bytes for a typed array, and never a silent copy.
Most of it is not built: an object parameter at an addon's export is refused
by name today ([Node addon](../targets/node-addon.md#what-crosses) lists what
crosses).

## Evidence

The measurements behind the dispatch choices are in records 0201, 0294, 0346
and 0348, and in the [calls](../records/notebooks/studies/primitives-calls.md)
and [objects](../records/notebooks/studies/primitives-objects.md) studies.

## Decisions

- **`globalThis`, `Proxy` with `Reflect`, and object integrity** (`freeze`,
  `seal`, `preventExtensions` and their predicates) are in scope, deferred, and
  each costs nothing where a program does not use it
  ([log](../records/notebooks/decisions-log.md#language-and-hosts-10-27)).
- **Acyclic types are proved, never declared:** no marker, internal or
  user-visible, so the descriptor's cycle flag is the compiler's proof
  ([log](../records/notebooks/decisions-log.md#memory-and-vendored-code-10-22-10-23)).
- **Objects cross an exported boundary by proof,** copied where invisible and
  live otherwise (the user's decision, record
  [0356](../records/0356-objects-cross-an-exported-boundary-by-proof-copied-where-invisible-live-otherwise.md)).
- **Nothing is fixed:** a representation that loses a benchmark row is replaced
  outright ([log](../records/notebooks/decisions-log.md#the-bar)).
- **The bounds rule:** every index is proved in range or checked, and a read
  out of range gives `undefined`, as JavaScript answers (X-5, with L4; 10-28,
  [log](../records/notebooks/decisions-log.md#debugging-security-and-versioning-10-28)).
  The checks are built; the `undefined` is not.
