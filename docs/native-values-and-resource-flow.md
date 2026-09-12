---
title: "RFC-0001: Native Values, Pointers, and ResourceFlow"
subtitle: "A native TypeScript interface with explicit, statically checked resource ownership"
date: "September 5, 2026"
status: "Draft for discussion · Version 0.1"
---

# RFC-0001: Native Values, Pointers, and ResourceFlow

**Status:** Draft for discussion  
**Version:** 0.1  
**Date:** September 5, 2026  
**Pipeline:** TypeScript source → typed HIR → LLVM IR → native code  
**Memory policies:** RC and No-RC remain supported  
**Implementation status:** Proposed design; no implementation in the compiler has been inspected or verified.

## Abstract

This RFC proposes a native-programming interface for a TypeScript-to-native compiler. It replaces routine byte-offset memory intrinsics with native values, typed pointer indexing, field access, address-of operations, and inline arrays. It adds an HIR analysis, called **ResourceFlow**, that checks explicit ownership and resource lifecycles before code generation.

The intended programming model is:

```ts
let yes: c_int = 1;
setsockopt(fd, SOL_SOCKET, SO_REUSEADDR,
           addrOf(yes), sizeof(yes));

let addr = zeroed<sockaddr_in>();
addr.sin_family = AF_INET;
addr.sin_port = htons(port as u16);
addr.sin_addr.s_addr = INADDR_ANY;
```

For heap storage, programmers may choose explicit cleanup:

```ts
const p = malloc(64) as OwnedPtr<u8> | null;
if (p === null) return -1;
p[0] = 42;
free(p);
```

Or scoped cleanup:

```ts
using p = malloc(64) as OwnedPtr<u8> | null;
if (p === null) return -1;
p[0] = 42;
```

Both forms use the same resource model. The first requires the programmer to discharge the ownership obligation. The second registers compiler-generated cleanup. Neither requires a JavaScript wrapper around the native allocation.

The TypeScript front end contributes syntax, symbols, ordinary type information, and tooling. The native compiler supplies native representation, lvalue semantics, ownership, lifetimes, ABI rules, and resource-flow proofs. This RFC does not claim that stock `tsc` enforces those additional rules.

## Reading map

Sections 1–3 establish the basis, scope, and compatibility boundary. Sections 4–8 specify native values, pointers, ownership, and borrowing. Sections 9–12 cover cleanup, FFI contracts, exceptional cases, and the HIR analysis. Sections 13–17 address code generation, RC/No-RC, diagnostics, guarantees, and Rust comparisons. Sections 18–21 give migration, implementation, testing, and open decisions. Appendices contain a complete multifunction example, its C counterpart, declaration sketches, and references.

# 1. Basis and decision status

## 1.1 Material carried forward

The supplied design note describes header-generated `.d.ts` declarations, explicit `malloc`/`free`, `__load_*` and `__store_*` intrinsics, byte-offset struct access, a socket echo server, a pthread worker pool, and generated HIR/LLVM signature tables. Those are the starting point, not evidence that the additional features below already exist. [B1, lines 5–129, 142–198, 241–339, 343–396]

The discussion then developed native stack values, `Ptr<T>`, `Ref<T>`, `FixedArray<T, N>`, `addrOf`, pointer offsets, owned pointers, scoped `using`, resource contracts, and a path-sensitive HIR analysis. This RFC organizes those proposals into a draft specification.

The names `nts`, `ResourceFlow`, the proposed annotations, and the configuration keys below are working spellings. They are not claims about the compiler's current command-line interface or repository structure.

## 1.2 Decisions made for this draft

Some earlier examples intentionally explored competing spellings. The following defaults make this document internally consistent; they remain reviewable.

| Topic | Draft default | Relationship to the discussion |
|---|---|---|
| Native zero initialization | `zeroed<T>()` | Keeps the earlier intrinsic. `let x: T = {}` remains a possible native-only shorthand. |
| Uninitialized storage | `uninit<T>()` | Makes storage creation explicit; a bare native declaration remains an alternative. |
| Pointer access | `p[i]`, `p.offset(i)`, `p.byteOffset(n)` | Retains typed indexing and distinguishes elements from bytes. |
| Address of a place | `addrOf(place)` | Retains the C-like operation without introducing `&` syntax. |
| Borrowed references | `Ref<T>` is shared/read-only; `MutRef<T>` is exclusive/writable | Earlier sketches sometimes used mutable `Ref<T>`; this draft separates the permissions. |
| Reference field access | `r.field` | Keeps the transparent-field proposal. |
| Whole referenced value | `r[0]`; writable for `MutRef<T>` | Avoids reserving `.value` or `.set`, which may already be struct fields. |
| Ownership assignment | Implicit move in an owning destination | Retains the preferred `const q = p` model. Borrowing is a distinct context. |
| Ordinary native pointers | `Ptr<T>` is non-owning, with tracked origin where available | It is not automatically an exclusive reference and is not an integer. |
| Unchecked interoperation | Explicit `RawPtr<T>` and an unchecked boundary | Makes the previously discussed escape hatch visible. |
| Native cleanup | Manual `free`, or `using` | Neither style replaces the other. |
| No-RC | No automatic reclamation of managed TS objects | Explicit native `free` and native `using` remain meaningful, as in the supplied examples. |

## 1.3 Normative language

**MUST** denotes a requirement of the proposed semantics, **SHOULD** a preferred implementation strategy, and **MAY** an optional extension. These words describe the proposal, not implemented guarantees.

External compatibility facts are cited with `[S#]`. Project-specific facts come from `[B1]` or the conversation. Everything identified as a draft rule, proposed API, analysis algorithm, or implementation phase is a design proposal.

# 2. Goals, non-goals, and invariants

The primary goal is to make native code readable without hiding native operations. A field assignment should look like a field assignment. A pointer offset should expose its units. Ownership transfer should be a compile-time operation rather than a wrapper allocation.

A second goal is to make explicit native resource errors diagnosable: omitted cleanup, repeated cleanup, use after release, use after move, release through a non-owner, allocator mismatch, and references escaping the storage they depend on.

A third goal is to retain experimentation. Existing raw intrinsics remain available. RC and No-RC are independent choices. The compiler can offer a verified resource subset and a clearly marked unchecked subset without silently treating one as the other.

The core invariants are:

1. Every successful owned acquisition creates one ownership obligation. Copying pointer bits does not create another obligation or another allocation.
2. A checked operation requiring a live resource is accepted only when that precondition is established in the supported analysis model.
3. A tracked obligation must be released, transferred to another tracked owner, or registered for cleanup before its owner disappears on a modeled exit.
4. Native addresses retain pointer representation and provenance metadata. Ordinary TS numeric operations do not accidentally become pointer operations.
5. An unknown contract, lost provenance, or analysis timeout must not be silently interpreted as a successful proof.

This RFC does not require a complete JavaScript runtime, unrestricted JavaScript compatibility, a tracing collector, a theorem prover for arbitrary programs, or a claim of superiority over Rust. It does not promise to detect all logical leaks, prove program termination, or prove race freedom in arbitrary C libraries.

# 3. TypeScript compatibility and compiler responsibilities

## 3.1 Syntax compatibility is not semantic equivalence

Most proposed spellings use existing TS syntax: generic type references, property access, element access, ordinary calls, assertions, interfaces, and `using` declarations. Nevertheless, a native pointer index is not a JavaScript property lookup, and `addrOf(x)` is not an ordinary by-value function call.

Stock TypeScript treats aliases as aliases, not distinct native scalar types, and erases type assertions rather than inserting native conversions. Those facts matter for declarations such as `type u16 = number` and expressions such as `port as u16`. [S2]

This compiler therefore MUST maintain a native type layer. A declaration-only library is useful for editing but is not the complete implementation of this RFC.

## 3.2 What to obtain from the TypeScript front end

The compiler SHOULD use the supported front-end API for resolved declaration symbols, imported aliases, ordinary types, selected call signatures, source locations, and diagnostics. The classic TypeScript compiler API exposes a `Program` and `TypeChecker`, including symbol and type queries. [S1]

The native compiler MUST additionally retain the identity of intrinsic declarations and propagate native types through its own expressions. It MUST NOT identify `free` by identifier text or infer `OwnedPtr` solely from a printed type name. Renaming an import must not change its semantics.

```ts
import { free as release } from "native/stdlib";
release(p); // Same consuming operation as the resolved free declaration.
```

An implementation may use branded declarations, a sidecar registry, and native annotation nodes together. A normal alias that collapses to `number` in the TS checker is insufficient by itself to preserve native width through every expression. The adapter MUST preserve the source declaration identity and perform native inference independently where needed.

The supported TypeScript front-end version and API family MUST be pinned and tested. The current classic Compiler API guide explicitly limits its setup example to TypeScript versions below 7; this RFC assumes no universal API compatibility across compiler generations. [S1]

## 3.3 Native diagnostics and editor integration

A TypeScript language-service plugin can supplement the editor experience, but it is not loaded by normal `tsc` command-line checking and cannot redefine the core language's typechecking semantics. [S3]

Accordingly, the native compiler's check/build command is authoritative. An editor integration SHOULD run the same native checking engine and display its source-mapped diagnostics. Stock `tsc` success is not a resource-verification certificate.

Examples such as `{}` zero initialization, fixed native storage before initialization, native narrowing assertions, implicit array-to-pointer conversion, and lvalue-sensitive intrinsics may require native diagnostic handling. The compiler MUST specify these divergences narrowly, rather than suppressing arbitrary TS errors.

## 3.4 Checking profiles

| Profile | Meaning |
|---|---|
| `off` | ResourceFlow does not enforce ownership obligations. Native representation and ABI checks still apply. |
| `audit` | ResourceFlow reports findings and proof gaps, but compilation may proceed. |
| `verify` | Violated resource rules and unresolved required resource proofs are compilation errors. |

These profiles govern resource analysis, not the runtime memory policy. They also do not, by themselves, imply that all memory accesses are bounds-checked. Bounds, initialization, alignment, and concurrency coverage MUST be reported separately.

# 4. Native types and representation

## 4.1 Scalars

The native prelude provides `i8`, `u8`, `i16`, `u16`, `i32`, `u32`, `i64`, `u64`, `f32`, `f64`, `usize`, and `isize`. C-facing names such as `c_int`, `c_uint`, `c_char`, `c_long`, `c_ulonglong`, `size_t`, `ssize_t`, and `socklen_t` describe the selected target ABI, not universal aliases.

Native scalar literals are checked against their contextual type. `i64` and `u64` examples may use bigint-style literal syntax, such as `1n`, without requiring runtime BigInt objects in the native representation.

Draft integer semantics: fixed-width addition, subtraction, and multiplication wrap at the declared width; signed values use two's-complement interpretation. Division by zero and the signed division overflow case require a diagnostic when proved, or a defined trap when evaluated. Allocation-size arithmetic is checked separately: wrapping `count * sizeof<T>()` must not silently establish a valid allocation extent.

Native `as` conversions between scalar types are explicit native conversions, including documented truncation or extension. They are not permission to forge ownership, erase nullability, or manufacture a valid reference. An assertion to the same native type has no runtime effect.

## 4.2 Values, pointers, and references

| Type | Meaning | Runtime representation in the basic design |
|---|---|---|
| Native `T` | Inline scalar or native aggregate value | Native scalar or aggregate |
| `FixedArray<T, N>` | Inline array of a compile-time positive element count | Inline array, not a TS array object |
| `Ptr<T>` | Non-owning pointer; origin, extent, and permissions tracked when known | Native pointer |
| `Ref<T>` | Non-null shared, read-only borrow of one initialized `T` | Native pointer |
| `MutRef<T>` | Non-null exclusive, writable borrow of one initialized `T` | Native pointer |
| `OwnedPtr<T>` | Unique ownership obligation for an allocated region | Native base pointer; ownership token is compile-time |
| `RawPtr<T>` | Pointer used outside the checked access contract | Native pointer |
| `OwnedFd` | Owned descriptor from a specific acquisition event | Target C descriptor representation |
| Managed TS reference | Existing managed object representation | Governed by the compiler's RC/No-RC policy |

`OwnedPtr<T>` owns storage, not necessarily an already initialized `T`. Initialization is a separate analysis fact. A successful allocation can therefore be released before initialization, but cannot be read as an initialized aggregate merely because it has a typed pointer.

A unique owner does not imply that no borrowed aliases exist. Conversely, a raw address does not establish any right to release storage. Ownership, access permission, initialization, and lifetime MUST remain distinct facts.

Nullable native pointers are written `Ptr<T> | null` or `OwnedPtr<T> | null`. Null checks refine validity; `as` and postfix `!` do not satisfy a native proof obligation by themselves.

## 4.3 Native aggregate declarations

A native aggregate is explicitly marked or imported through generated metadata:

```ts
/** @native.layout("c") */
interface Stats {
    bytes: u64;
    lines: u64;
    words: u64;
    hash: u32;
}
```

`@native.layout` is a proposed compiler annotation, not a standard TypeScript feature. Unmarked interfaces retain the compiler's ordinary TS-object semantics.

The layout record MUST contain target identity, size, alignment, field offsets, field types, and relevant packing or bit-field information. Native layout MUST be nominal at the ABI boundary: structural TS compatibility alone does not authorize interchanging layouts.

The initial aggregate-copy feature is restricted to native values without owned-resource fields or managed references. Pointer fields retain their lifetime/provenance dependencies when copied. Aggregates containing owned fields require move-aware field analysis and destruction rules; they are not silently copied with `memcpy`.

Opaque C types need not expose fields. Their generated storage size and alignment are still usable. Independently initialized native resources, such as mutexes, also require a non-copyable semantic contract even when their bytes fit in an aggregate.

# 5. Places, initialization, and field access

## 5.1 Places are first-class in HIR

A **place** is a location that can be addressed, read, or written: a local, a dereference, an array element, or a struct field.

```text
Place := Local(id)
       | Deref(pointer)
       | Index(base, index, element_type)
       | Field(base, layout_id, field_id)
```

The same place participates in different operations:

```ts
const n = p[0].count;          // Read the place.
p[0].count = 5;                // Write the place.
const field = addrOf(p[0].count); // Obtain its address.
```

Lowering MUST NOT load or copy an intermediate aggregate merely to reach a nested field. The address of the original field is used. By contrast, `let copy: Stats = p[0]` explicitly produces a native value copy when `Stats` is copyable.

Compound assignment and increments evaluate the destination's address once. They are not automatically atomic operations.

## 5.2 Initialization

```ts
let stats = zeroed<Stats>();
let bytes = uninit<FixedArray<u8, 4096>>();
```

`zeroed<T>()` creates a native value with valid zero/default values for its fields. It is available only when the native type permits that initialization; it is not an initializer for arbitrary mutexes, non-null references, or owned handles. Bytewise zero filling is used only when justified by the target representation.

`uninit<T>()` reserves native storage but does not establish readable values. It is a compiler intrinsic, not a function returning a valid arbitrary `T` in ordinary TS semantics. Reads before initialization are rejected where this checking is enabled. Passing the storage to a declared out-parameter is permitted, and the call's postcondition establishes which bytes or fields became initialized.

The shorthand `let addr: sockaddr_in = {}` remains an open native-only syntax choice. It MUST NOT be introduced by making all generated struct fields optional: that would change ordinary type information rather than define native initialization.

## 5.3 Address of a place

`addrOf(place)` produces a non-owning pointer with the place's lifetime, bounds, and permissions. It is evaluated as address formation, not as a by-value argument followed by a runtime call.

```ts
let x: i32 = 10;
const px = addrOf(x);
px[0] = 11;
```

The native checker rejects addresses of unsupported temporaries and rejects mutable access to a non-writable place. `const` prevents rebinding; a native aggregate's separately writable fields remain addressable according to their permissions. Examples requiring writable whole-object addresses use `let`.

When a function expects `Ref<T>` or `MutRef<T>`, a pointer obtained from a suitable place may be converted into a temporary checked borrow. This requires the appropriate extent, initialization, lifetime, and alias conditions; it is not an arbitrary pointer cast.

An addressable local may lower to stack storage. This is not an assertion that the pointer escapes the function; a nonescaping address can still be optimized away.

## 5.4 Size and alignment

`sizeof<T>()` and `alignof<T>()` are compile-time layout queries. `sizeof(place)` is an unevaluated query on the native type of the place. It does not read an uninitialized object or evaluate side effects inside the operand.

`sizeof(pointer)` is the pointer representation's size, not the allocation's size. The allocation extent is tracked separately. A dynamic TS array is not a `FixedArray`, and its storage size is not inferred from `sizeof`.

# 6. Pointer operations and C correspondence

The original `__store_i32(p, off, value)` uses a byte offset. It remains a low-level operation. Its direct aligned C analogue is a store through an `int32_t *` at `(unsigned char *)p + off`; the RFC adds the following source-level alternatives. [B1, lines 110–129, 146–155]

| Intent | C | Proposed native TS |
|---|---|---|
| Initialize an addressable integer | `int yes = 1;` | `let yes: c_int = 1;` |
| Address of the integer | `&yes` | `addrOf(yes)` |
| Store the first pointee | `*p = 1;` | `p[0] = 1;` |
| Store element three | `p[3] = 7;` | `p[3] = 7;` |
| Pointer plus elements | `p + n` | `p.offset(n)` |
| Pointer plus bytes | `(unsigned char *)p + n` | `p.byteOffset(n)` |
| Native field assignment | `addr.sin_port = port;` | `addr.sin_port = port;` |
| Field through a pointer | `p->sin_port = port;` | `p[0].sin_port = port;` |
| Field through a reference | `state->stats.bytes++` | `state.stats.bytes += 1n` |
| Copy to an out-parameter | `*out = stats;` | `out[0] = stats;` |

`offset(n)` counts elements and accepts a signed native displacement. `byteOffset(n)` counts bytes and returns a byte pointer. An offset from an `OwnedPtr<T>` produces a borrow, not a new owner; freeing an interior pointer is rejected.

The checked contract distinguishes address formation from access. A one-past pointer may be formed under the selected native rules, but it cannot be dereferenced. Offsetting `Ptr<void>` by elements is rejected because the element size is absent; byte offsets remain expressible.

The low-level intrinsics MUST specify alignment, volatility, atomicity, and byte-order semantics. Ordinary `__store_i32` is not silently a volatile or atomic operation, and host-endian memory access is not a network-endian conversion. Packed or unaligned access needs a suitable explicit operation or verified lowering.

`errno` is a generated native accessor/place for the selected platform, not a cached global integer. Header macros or inline-only APIs require supported expansion or an explicit generated thunk; the generator must not invent an external function symbol that the ABI does not provide.

# 7. Ownership semantics

## 7.1 Acquisition and release

A successful allocation creates a fresh resource identity, even if an address has been reused. A nullable failure result creates no allocation obligation.

```ts
const p = malloc(64) as OwnedPtr<u8> | null;
if (p === null) return -1;

p[0] = 42;
free(p);
```

The public signature can advertise ownership, while the resolved foreign contract describes the allocator family, nullability, extent, alignment, and release operation. The generated native ABI remains the underlying C ABI.

`free` consumes the matching live allocation obligation. It accepts null according to its native contract, but it does not accept a borrowed pointer, stack address, interior address, or resource from an incompatible allocator family. The C allocation API's null and allocation-failure behavior is documented separately from this RFC's ownership types. [S7]

## 7.2 Moves

Assigning an owned value to an owning destination transfers the obligation:

```ts
const p = malloc(64) as OwnedPtr<u8> | null;
if (p === null) return -1;

const q = p; // Move ownership to q.
free(q);
p[0] = 1;    // Error: p was moved.
```

Passing to an `OwnedPtr<T>` parameter and returning an owned result are also moves. Reading through the owner or passing it to a verified borrowing parameter is not a move.

```ts
function destroy(p: OwnedPtr<u8>): void {
    free(p);
}

function inspect(p: Ptr<u8>): u8 {
    return p[0];
}
```

`inspect` has an initialized-one-byte precondition and a no-capture summary. A call to `destroy(buf)` transfers ownership; a call to `inspect(buf)` creates a temporary borrow. The compiler derives or checks these effects, rather than guessing from names.

Discarding an owned temporary is an error. Overwriting a live owning slot without releasing or transferring its existing resource is an error. Moving through an aggregate, generic container, closure, or union must preserve the obligation; unsupported forms are rejected in `verify` mode.

## 7.3 Obligations at exits

An owner must not disappear with an undischarged obligation on a modeled scope exit, return, exception edge, or overwrite.

```ts
function broken(stop: boolean): i32 {
    const p = malloc(64);
    if (p === null) return -1;
    if (stop) return 0; // Error: the live allocation is abandoned.
    free(p);
    return 0;
}
```

Returning an owner is a transfer, not a leak. Moving it into a checked owning container transfers the obligation to that container; it does not erase it. Global owners need a declared process-lifetime policy or a checked shutdown owner.

The rule is resource accounting at modeled control-flow boundaries, not a proof of eventual release in infinite executions. A server may intentionally keep a live owner while running. A cache may grow while retaining all its owners. Those are not automatically diagnosed as logical leaks.

## 7.4 Escape is not a successful proof

An unknown call that may capture a pointer is not equivalent to a verified ownership transfer. ResourceFlow records a proof gap and rejects the operation in `verify` mode unless a suitable contract or explicit unchecked boundary is supplied.

An explicit ownership-to-raw operation may consume the local checked token only by recording an unchecked transfer. Its presence must appear in the verification report. An intentional leak operation, if added, must be identified as abandonment rather than counted as successful reclamation.

`as any`, `as unknown`, pointer-to-integer conversions, and reconstructed casts MUST NOT bypass these rules in checked code.

# 8. Borrowing, references, and aliasing

`Ptr<T>` supports familiar native aliasing. ResourceFlow tracks all known aliases back to the same region. Losing an owner variable is not the same as invalidating the region; freeing the allocation is.

```ts
const p = malloc(64) as OwnedPtr<u8> | null;
if (p === null) return -1;

const q: Ptr<u8> = p; // Borrow, not ownership duplication.
free(p);
q[0] = 7;             // Error: q refers to the released region.
```

The checker SHOULD use last-use liveness rather than merely lexical scope for borrowed aliases. A borrow that is never used again need not prevent release. This analysis must include uses through reachable aggregates, closures, callbacks, and foreign capture contracts, or reject those cases when unsupported.

`Ref<T>` adds a shared read-only loan. `MutRef<T>` adds an exclusive writable loan. During a live shared loan, conflicting writes through another checked alias are forbidden. During an exclusive loan, overlapping conflicting access through any other checked alias is forbidden. `Ptr<T>` by itself does not imply either exclusivity or LLVM `noalias`.

```ts
let state = zeroed<ScanState>();
scanBuffer(buf, count, addrOf(state));
```

At a call expecting `MutRef<ScanState>`, the compiler creates a temporary exclusive loan of `state`. `state.stats.bytes` inside the callee is forwarded field access on the original storage.

To avoid field-name collisions, references reserve no string-named `.value` or `.set` member. `r[0]` denotes the complete referenced value; only index zero is allowed. Native struct field names are distinct from that intrinsic reference index operation.

Returning `addrOf(local)` is rejected when the local ends before the returned reference. Returning a borrow into an argument may be allowed with an explicit or inferred result-lifetime relationship. Arbitrary return-borrow inference and self-referential aggregates may be deferred, but cannot be accepted on an unproved lifetime assumption.

Distinct constant fields or provably disjoint array ranges may support simultaneous mutable loans. Dynamic index relationships require a proof or an explicit alternative. More permissive analysis is an extension of the proof engine, not a reason to relax the meaning of `MutRef<T>`.

# 9. Scoped cleanup with `using`

## 9.1 Surface and native lowering

TypeScript's existing `using` syntax is associated with disposal through `Symbol.dispose`; native lowering that calls `free` directly is an additional compiler rule, not the behavior of arbitrary stock TypeScript objects. [S4]

For a recognized native resource, the compiler associates a cleanup operation with the binding:

```ts
function work(): i32 {
    using buf = malloc(4096) as OwnedPtr<u8> | null;
    if (buf === null) return -1;
    buf[0] = 42;
    if (stopEarly()) return 0;
    consumeBytes(buf, 1);
    return 0;
}
```

The non-null owner is released on either return. No disposal wrapper object is required. A declaration projection may expose `Disposable` for editor compatibility, but the native compiler resolves the cleanup operation from resource metadata.

## 9.2 Cleanup semantics

Cleanup registrations are tied to successful initialization and lexical scope. Resources are cleaned up in reverse registration order. `return`, `break`, `continue`, and supported exception edges execute the cleanups for every scope they leave. Loop-body registrations apply to that iteration, not to every future iteration.

A return expression is evaluated before its enclosing cleanups. Returning a pointer into a resource about to be cleaned up is therefore an error. If an initializer fails or throws, already registered resources are cleaned up; the unsuccessful acquisition does not register a live resource.

For nullable native allocations, a null value has no release obligation. A backend may emit a null test, use a null-tolerant cleanup, or remove redundant branches when justified by the foreign contract.

## 9.3 Early manual release and moves

The initial rule is deliberately simple: a native `using` binding cannot be manually consumed, reassigned, or moved out of its cleanup scope.

```ts
using p = malloc(64);
free(p);  // Error: cleanup is already owned by the using binding.
return p; // Error: moving out would conflict with registered cleanup.
```

Ordinary borrows remain allowed. Early-release or `take` operations can be added later with an explicit cleanup-cancellation rule. They are not implemented by silently scheduling a second free or by assuming a runtime liveness flag always exists.

## 9.4 Cleanup failure and abnormal control flow

The first native cleanup operations SHOULD be nonthrowing operations with an unambiguous consumption contract, such as a modeled `free`. A resource whose cleanup returns an actionable error must define an error policy before it can participate in implicit cleanup. Explicit `close` remains available when the caller needs its status.

Generated cleanups MUST preserve a pending exception or error-reporting state where the language/FFI contract requires it. They must not replace the original error with incidental cleanup state.

If native exceptions are supported, cleanup edges must cover the selected exception model. If they are not supported, calls capable of unwinding through verified native frames must be rejected or routed through a declared boundary. `longjmp`, thread cancellation, process termination, signals, and foreign unwinding require separate contracts; ordinary CFG cleanup does not automatically cover them. No guarantee of cleanup after process termination is made.

# 10. Header generation and foreign resource contracts

## 10.1 Two sources of information

The header importer produces **ABI facts**: declarations, typedefs, layouts, constants, calling conventions, and supported macro expansions. Ownership and lifetime **semantic contracts** come from explicit annotations, trusted library models, or summaries verified from available bodies.

These are distinct inputs. A C prototype alone generally does not say whether a callee saves a pointer, whether ownership transfers only on success, or whether a returned alias remains valid after another call. A generated binding MUST NOT infer those facts merely from a function's spelling.

Clang's analyzer already supports ownership-oriented source annotations, including acquisition and ownership-taking/holding contracts. Such annotations are useful precedents and potential inputs; this RFC's checking model is not a claim that resource contracts are a new concept. [S5]

## 10.2 Binding manifest

A single canonical manifest SHOULD generate the source declarations, HIR call metadata, and LLVM ABI signatures. This continues the supplied proposal's single-header-parse direction while adding resource information. [B1, lines 343–369]

The manifest MUST be keyed to the target triple, data layout, relevant compiler options, feature macros, header/SDK identity, and contract version. Parsing the required translation unit includes prerequisites such as the headers that actually define the imported network structures; a filename alone is not a complete ABI specification.

Field offsets and the size of a struct include alignment and tail padding. The pool's handwritten sum of field sizes is not the authoritative `sizeof` for a target. The generated native struct layout replaces those source constants without requiring a change to the underlying native API. [B1, lines 241–256]

Unknown bit-fields, unions, calling conventions, variadic rules, or macro forms must produce an unsupported-binding diagnostic rather than an invented approximation.

## 10.3 Contract vocabulary

The contract system needs to express:

| Contract information | Example |
|---|---|
| Acquisition condition | A new region exists only when `malloc` returns non-null. |
| Resource family | `malloc`-family storage is released by the matching `free`. |
| Borrow permission | A call reads or writes a borrowed region but does not own it. |
| Capture behavior | A call does not retain a pointer beyond return, or retains it until an identified event. |
| Consumption condition | An argument is consumed unconditionally or only on a specific outcome. |
| Extent and alignment | Allocation byte count, buffer capacity, and required alignment. |
| Initialization effect | A successful read initializes the first `result` bytes. |
| Alias relation | A returned pointer aliases argument zero, or is a fresh allocation. |
| Resource state | A handle is initialized, open, locked, joined, or destroyed. |
| Exceptional effects | Whether a call can unwind, cancel, or fail without consuming its resource. |

Contracts attach to resolved declarations, not source names. Definition checking MUST verify an available function body against its declared resource effects. Foreign bodies remain a trust boundary.

## 10.4 Illustrative manifest fragment

The JSON spelling is illustrative; its conditions and effects are normative requirements of the design.

```json
{
  "symbol": "malloc",
  "result": {
    "abi": "ptr",
    "nullable": true,
    "resourceFamily": "c.malloc",
    "acquireWhen": "result != null",
    "extentBytes": "arg0",
    "initialized": false,
    "basePointer": true
  }
}
```

```json
{
  "symbol": "free",
  "arguments": [{
    "index": 0,
    "requires": "null OR live_base_owner(c.malloc)",
    "effect": "consume_if_nonnull"
  }],
  "unwind": "never"
}
```

Resource acquisition is not limited to pointers. `open` and `socket` can produce an `OwnedFd` obligation when the result is nonnegative, while retaining the C integer representation. A cast from an arbitrary integer cannot manufacture such an obligation. Borrowing a descriptor for `read` is not moving it into the callee.

The same model covers `fopen`/`fclose` and `mmap`/`munmap`. A stream is not released with `free`; a mapping contract includes its address range and release length. Partial unmapping and resource adapters need explicit transition rules rather than a generic assumption that every destructor consumes one pointer.

Descriptor identity includes its acquisition generation. Reusing the same numeric descriptor after a close creates a different resource. Duplicating a descriptor through a modeled duplication API creates another close obligation; copying the integer does not.

# 11. Difficult native operations

## 11.1 `realloc`

For a positive requested size, failed reallocation leaves the original block intact, while success yields the replacement allocation result. Zero-size reallocation has target/language-version complications and must not be modeled as the ordinary failure case. [S7]

Draft rule: checked `realloc` requires a proved positive size. Zero-size calls are rejected in checked code until a target-specific contract is selected.

```ts
let p = malloc(64) as OwnedPtr<u8> | null;
if (p === null) return -1;

const next = realloc(p, 128) as OwnedPtr<u8> | null;
if (next === null) {
    free(p);  // Failure retained the original owner.
    return -1;
}
p = next;     // Success replaces the invalidated old owner.
free(p);
```

Between the call and refinement of its result, the analysis preserves the relationship between the outcome and both owner states. Operations requiring one definite state are rejected until that relationship is resolved. The signature is not treated as an unconditional consume-and-return operation.

On success, all earlier views into the old allocation are invalidated by the checked language model, even if the numeric address happens to be unchanged. On failure, the old extent and contents remain associated with the original owner. Newly added bytes after growth are not automatically initialized.

The assignment `p = realloc(p, n)` is rejected when failure would overwrite the only owner of the original region. An ownership-aware alternative resize intrinsic is a future ergonomic option, not a prerequisite for direct C calls.

## 11.2 Out-parameters and partial initialization

A call such as `read(fd, buf, capacity)` needs a contract relating its result to the initialized byte range. The Linux API can return fewer bytes than requested; a short read is not an error. [S8]

A successful result `n` establishes that the first `n` bytes may be read. It does not establish initialization of the full capacity. A subsequent `scanBuffer(buf, n, state)` is valid only when its preconditions match that initialized extent. An error branch must not treat a negative result as an unsigned length.

The same principle applies to `accept`'s address buffer and length out-parameter: capacity before the call and initialized/returned size after the call are separate facts.

## 11.3 Release operations with error results

A release returning an error does not universally mean that the resource remains live. On Linux, retrying `close` after an error can close a reused descriptor; the platform contract must reflect the actual consumption behavior. [S9]

This draft's Linux examples treat a close of a valid owned descriptor as consuming that descriptor, while the return value reports the operation's error status. This is not declared to be a universal contract for all operating systems. A different target must supply its own rule.

## 11.4 Native resource state inside allocated storage

The worker pool combines memory ownership with initialized mutex and condition-variable state. These are related but distinct obligations. Freeing the backing pool storage does not discharge a required mutex-destruction obligation by magic, and destroying a mutex does not free the pool allocation.

ResourceFlow therefore needs parent-storage dependencies: initialized embedded resources depend on the containing allocation, and its release requires their applicable lifecycle obligations to have ended. Copying initialized synchronization objects is rejected unless the target contract explicitly permits it.

The initial implementation may require explicit destruction sequences and reject unmodeled nested resource states. Automatic aggregate cleanup is a later feature.

## 11.5 Threads, callbacks, and asynchronous capture

`pthread_create` cannot be annotated as a simple no-capture call for its argument. The worker may use that storage after the creating call returns. Its contract must model the callback, the retained argument, and the event that ends that use.

For a joinable thread, a successful modeled join can discharge the corresponding callback-lifetime dependency. Detached threads need a different ownership-transfer or shared-lifetime model. Merely calling a function named `join` is not a proof that every retained alias has ended.

Captured closures cannot automatically be passed as plain C function pointers. The initial callback support may accept only compatible noncapturing functions, with context passed explicitly through the C argument.

ResourceFlow alone does not prove race freedom, deadlock freedom, correct queue capacity, or synchronization protocol correctness. Those properties require additional contracts and analysis. Until supported, sharing checked mutable references across threads is rejected rather than accepted under an implicit single-thread assumption.

# 12. ResourceFlow: HIR analysis design

## 12.1 Analysis inputs and placement

ResourceFlow runs over typed HIR before ownership information is erased and before final RC insertion. Its inputs include the CFG, native types, places, source spans, call contracts, allocation events, and any inferred summaries.

```text
TS parse + symbol/type adapter
             |
Native semantic checking and typed HIR
             |
CFG + exceptional edges + cleanup obligations
             |
ResourceFlow + initialization/lifetime checks
             |
Verified cleanup expansion + managed RC/No-RC lowering
             |
Native ABI lowering -> LLVM IR -> native code
```

Cleanup obligations must be visible during checking; the implementation must not report an owner registered by `using` as an unhandled leak. Expanded cleanup IR is checked again for consistent effects.

The compiler owns this CFG. It does not depend on undocumented TS internal flow-node layouts to encode the native ownership system.

## 12.2 Track resources, not just variables

A variable-state enum alone is insufficient. The analysis separates at least:

```text
Binding state: uninitialized | owns(R) | borrows(R) | moved
Region state:  absent | live | released
Resource data: family, generation, base, extent, alignment
Initialization: initialized fields/byte ranges
Loans: access kind, region/range, lifetime dependencies
Obligations: owner, registered cleanup, dependent resources
Path facts: predicates and outcome-dependent relationships
```

A moved binding does not imply a freed region. A released region invalidates all dependent views, not just the binding passed to the release operation. A nullable allocation has an absent-resource alternative until refined.

At joins, the analysis retains a conservative union of feasible abstract states. `LIVE | RELEASED` is not treated as definitely live. Field-sensitive owner slots and phi-like merges may be needed when one destination owns different acquisitions on different branches.

## 12.3 Transfer operations

| HIR operation | Preconditions | Abstract effect |
|---|---|---|
| Acquire | Contract success condition | Create fresh resource and ownership obligation. |
| Move | Source owns a live resource; destination may receive it | Transfer the token; invalidate source ownership. |
| Borrow | Region live; permissions and lifetime sufficient | Create a dependent view/loan. |
| Load/store | Required liveness, access, extent, and initialization | Read or update memory facts; ownership unchanged unless a typed owner field moves. |
| Release | Live matching owner; valid base; no conflicting surviving dependencies | Discharge token; invalidate dependent views. |
| Register cleanup | Live or conditionally live owner | Attach a scope-exit consumption obligation. |
| Return owned | Function result accepts ownership | Transfer to caller obligation. |
| Unknown capture | No established lifetime summary | Introduce a proof gap, not a verified transfer. |

Pure address formation need not initialize or read the pointee. A memory access requires more than ownership alone; missing bounds or initialization support cannot be hidden behind a live token.

## 12.4 Worklist and fixed point

A baseline implementation is a forward abstract interpretation with backward use/lifetime information:

```text
Build CFG and model supported exceptional exits.
Create the entry state from parameter contracts.
Place entry block on the worklist.

While a block is pending:
    Join incoming abstract states conservatively.
    Apply each instruction's requirements and effects.
    Refine states for each outgoing condition.
    Update successors whose states changed.

At each ownership boundary:
    Check outstanding obligations and cleanup coverage.
At each access:
    Check the required resource and memory facts.
```

Loops require fixed-point iteration, with widening or bounded predicates to ensure analysis termination. Allocations in a loop are not represented by an unbounded list of concrete runtime objects; the abstraction must still detect an obligation lost on a back-edge, overwrite, or exit.

If a widening step loses a fact needed to approve an operation, the checker reports that it cannot establish the precondition. It must not optimistically treat the fact as true.

## 12.5 Path sensitivity

A baseline join may reject this pattern:

```ts
const p = malloc(64);
if (p === null) return -1;
const releaseEarly = choose();

if (releaseEarly) free(p);
if (!releaseEarly) free(p);
```

An enhanced analysis may prove that the stable local boolean selects exactly one release. Similarly, it can retain `released == true => region released` relationships for a local flag.

This requires tracking the particular evaluated value, not assuming that two calls to `choose()` return the same result. Writes through aliases, calls that can mutate the predicate's storage, and thread interference invalidate affected facts.

Path sensitivity is an acceptance improvement. It does not expand the safety claim when the proof engine cannot establish the required relationship. Solver exhaustion must produce a proof-gap diagnostic, not a successful verification result.

## 12.6 Interprocedural summaries

A function summary describes argument ownership modes, capture behavior, read/write ranges, result ownership or aliasing, outcome-dependent effects, and supported exceptional exits.

Source-defined functions may have inferred summaries, checked against exported contracts. Recursive call groups require conservative fixed points or explicit summaries. Indirect calls require a compatible function-pointer effect signature. Unknown foreign functions cannot inherit no-capture behavior by default.

Incremental caches MUST include source/body identity, imported contract versions, target layout, and relevant analysis configuration. An editor cannot reuse a proof produced for a different contract or target merely because the source line still looks the same.

# 13. HIR-to-LLVM lowering

## 13.1 Pointer representation

LLVM's opaque-pointer representation uses `ptr`; access types are carried by operations rather than encoded in pointer type names. [S6]

The native HIR SHOULD have an actual pointer kind, with address-space and target information, rather than representing every pointer as an unconditional `i64`. This deliberately refines the supplied note's proposed numeric-pointer representation. [B1, line 396]

```text
HirPtr {
    pointee_layout,
    address_space,
    access_permissions,
    origin_and_lifetime
}
```

`usize` is target-sized. Pointer-to-integer operations are explicit native operations, not ordinary TS-number arithmetic. Ownership and lifetime metadata are retained until their checks and transformations no longer need them.

## 13.2 Representative lowering

```ts
p[3] = 123; // p: Ptr<i32>
```

```llvm
%element = getelementptr i32, ptr %p, i64 3
store i32 123, ptr %element, align 4
```

This illustrative fragment assumes a target with the shown index width and established alignment. It is not a universal instruction template.

```ts
let yes: c_int = 1;
setsockopt(fd, SOL_SOCKET, SO_REUSEADDR,
           addrOf(yes), sizeof(yes));
```

The addressable integer can lower to a native stack slot and a direct native call. Typed field access becomes an address computation using the generated layout, then a load or store. Plain aggregate copies may use scalar operations or an appropriate aggregate copy; self-assignment and overlap must preserve the language's value-copy semantics.

## 13.3 Optimization promises require proofs

LLVM attributes and flags such as `inbounds`, `noalias`, and arithmetic no-wrap flags carry semantic requirements. [S10]

The backend MUST NOT add `noalias` solely because a pointer has a unique ownership token. It MUST NOT add `inbounds` to arbitrary raw pointer arithmetic, promise more alignment than was established, or mark wrapping integer operations as no-wrap. Memory allocation contracts may justify specific attributes, but blanket annotations do not follow from the source API's appearance.

No new LLVM instruction is required for ResourceFlow. Ownership tokens and most loan metadata are compile-time information. Optional dynamic checks, cleanup branches, and the existing RC runtime still have whatever costs their selected semantics require; this RFC does not claim every configuration is zero-cost.

# 14. Interaction with RC and No-RC

This RFC interprets No-RC consistently with the supplied explicit `malloc`/`free` examples: managed TS objects are not automatically reclaimed, while explicitly owned native resources may still be released by source-selected native operations. This interpretation is a draft policy choice, not a change silently imposed on an existing implementation.

| Operation | RC mode | No-RC mode |
|---|---|---|
| Native scalar store | Native store | Native store |
| Borrowed native pointer store | Native store, with compile-time checks | Same |
| Manual `free(OwnedPtr)` | Release the native resource | Same |
| Native `using` cleanup | Run the declared native cleanup | Same |
| Managed-reference assignment | Existing retain/release semantics | No automatic retain/release reclamation |
| Managed object no longer referenced | Existing RC reclamation behavior | Object remains allocated |
| Stack scope ends | Stack lifetime ends | Same |

The resource checker targets declared ownership obligations. It does not classify every managed allocation in No-RC mode as a missing `free`. A native `using` declaration is explicit resource-lifetime intent, even though the compiler inserts the final call.

A native owner must not be implicitly converted into a managed reference, nor may `free` consume a managed object. Bridges between managed and native representations require explicit ownership contracts.

For managed assignment under RC, the compiler's established convention must handle self-assignment and destructor reentrancy. A conceptual sequence is to protect the new reference, obtain the old reference, store the new reference, and then release the old one; exact retain elision follows the actual ownership convention. Native integer stores do not gain RC operations.

The earlier name `Rc<T>` may remain useful in internal HIR descriptions or as a future explicit API, but this RFC does not require replacing the existing TS managed-object model with that public type.

# 15. Diagnostics and developer experience

Diagnostics MUST identify whether the compiler proved a rule violation or failed to prove a required precondition. A potential path is not automatically a demonstrated runtime execution.

Proposed diagnostic families:

| Code | Meaning |
|---|---|
| `NOWN001` | Live ownership obligation abandoned at an exit or overwrite. |
| `NOWN002` | Repeated release, or release on a possibly released path. |
| `NOWN003` | Access through a released region. |
| `NOWN004` | Use of a moved owning binding. |
| `NOWN005` | Release through a non-owner, interior pointer, or wrong allocator family. |
| `NLIFE001` | Borrow escapes its owner's lifetime. |
| `NLIFE002` | Conflicting overlapping borrow/access. |
| `NINIT001` | Read of storage not established to be initialized. |
| `NBOUNDS001` | Invalid index/range, or required extent proof missing. |
| `NFFI001` | Missing/inconsistent native ABI or resource contract. |
| `NPROOF001` | Required proof unavailable in the configured analysis. |
| `NCLEAN001` | Explicit consumption conflicts with registered cleanup. |

Example:

```text
error[NOWN001]: allocation is not released on this return path

  8 | const buf = malloc(4096);
                  ------------ allocation acquired here
  9 | if (buf === null) return -1;
 10 | if (failed) return 0;
                  ^^^^^^^^ live ownership is abandoned here

note: release buf, transfer ownership, or bind it with using
```

An alias diagnostic should name the allocation and the dependent alias:

```text
error[NOWN003]: 'view' accesses a released allocation

  5 | const view: Ptr<u8> = buf;
                           --- view borrows this allocation
  6 | free(buf);
      --------- allocation released here
  7 | view[0] = 42;
      ^^^^^^^ access depends on the released allocation
```

The editor SHOULD show ownership state at the selected program point, not overwrite the ordinary declared type with a misleading temporal TS type. Source navigation can connect acquisition, transfer, borrow, and release locations. The command-line and editor checks must share the same semantics.

Automatic fixes should be offered only when their scope is justified. Moving a cleanup into an `else` branch, for example, is not universally correct when ownership must survive beyond that branch.

# 16. Guarantees and boundaries

A successful `verify` result means that the configured resource rules were established within the supported model, assuming the imported contracts and unchecked boundaries are respected. It is not an unconditional theorem about every byte of a linked native program.

| Property | Intended treatment |
|---|---|
| Missing release at a modeled owner boundary | Error for an undischarged explicit ownership obligation. |
| Repeated release and use after release | Error for tracked resources and aliases. |
| Use after move | Error for tracked owning bindings. |
| Wrong deallocator or interior-pointer release | Error when applying a modeled release operation. |
| Dangling local reference | Error under supported lifetime/capture analysis. |
| Constant out-of-range index | Compile-time error. |
| Dynamic bounds and byte initialization | Prove, insert explicitly configured checks, or report an unsupported proof; coverage must be stated. |
| Unmodeled FFI and pointer reconstruction | Explicit trust/unchecked boundary, not silently verified. |
| Managed No-RC growth, reachable caches, intentional process lifetime | Not a missing native-release error by default. |
| Thread races, deadlocks, arbitrary cancellation | Not guaranteed by the baseline ResourceFlow pass. |

Three claims must stay separate: **no detected issue**, **resource rules verified under assumptions**, and **a fully memory-safe checked subset**. The first does not imply the second, and resource accounting alone does not establish the third. A future memory-safe profile requires sound handling of bounds, initialization, alignment, provenance, concurrency, and all permitted escape operations.

An audit report SHOULD list unchecked boundaries, missing contracts, and unproved categories. Turning a required error into a warning changes the checking profile; it does not preserve its guarantee.

# 17. Relationship to Rust and existing analysis tools

Rust's normal ownership model uses automatic destruction, while its references enforce borrowing rules. Its standard library explicitly permits forgetting a value without running its destructor, and reference cycles can leak. Resource reclamation is therefore not identical to Rust memory safety. [S11, S12]

This RFC chooses a different local policy for explicit native owners: disappearance of an undischarged obligation is an error unless cleanup or transfer is established. That policy can be stricter about a particular class of resource-accounting mistakes without being a generally stronger memory-safety system.

| Dimension | Comparison to make |
|---|---|
| Explicit native API cleanup | Compare accepted/rejected lifecycle examples and required annotations. |
| Automatic cleanup | Compare native `using` with normal automatic destruction, not with manual unsafe Rust allocation alone. |
| Borrowing and aliasing | Compare equivalent access and lifetime guarantees, not just fewer rejected programs. |
| Path sensitivity | Measure whether particular safe control-flow patterns are accepted under the same assumptions. |
| FFI | Count trusted contracts and unchecked boundaries on both sides. |
| Diagnostics | Evaluate trace quality and actionable explanations using the same bug corpus. |
| Performance | Measure compile time, code size, and runtime for equivalent semantics. |

Rust also has an explicit concurrency model around `Send` and `Sync`; this RFC's initial single-threaded resource analysis is not a replacement for such guarantees. [S13]

Clang's existing analyzer ownership annotations are another relevant comparison point. The proposed differentiator is the combination of native TS syntax, generated C bindings, mandatory checked resource contracts, and integration with this compiler's HIR—not the invention of static ownership analysis itself. [S5]

Any statement that this system is “better than Rust” remains a hypothesis to evaluate against defined workloads and properties. This RFC commits to a testable design, not that comparative conclusion.

# 18. Migration and compatibility

Adoption SHOULD be incremental and explicit. Existing raw intrinsics retain their documented behavior in the compatibility profile; introducing ResourceFlow must not silently reinterpret every legacy pointer alias as an owner.

The first migration step is syntactic: replace routine offset loads/stores with typed indexing and generated fields. The second is semantic: add ownership/capture contracts and nullability. The third is to enable verification for a module after resolving its outstanding obligations and unsupported boundaries.

```ts
// Original interface.
const yes = malloc(4);
__store_i32(yes, 0, 1);
setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, yes, 4);
free(yes);

// Native value interface: no heap owner needed.
let yes: c_int = 1;
setsockopt(fd, SOL_SOCKET, SO_REUSEADDR,
           addrOf(yes), sizeof(yes));
```

This transformation applies to addressable temporary storage; it is not a rule that all heap allocations should become stack allocations. Storage duration and escape behavior remain part of the program's design.

An illustrative configuration is:

```json
{
  "native": {
    "memoryManagement": "no-rc",
    "resourceChecking": "verify",
    "contracts": ["./generated/native-contracts.json"],
    "reportUncheckedBoundaries": true
  }
}
```

`memoryManagement` and `resourceChecking` are independent. Changing a module from `audit` to `verify` must not silently enable a collector or change a borrowed pointer into an owning runtime object.

Legacy and checked modules can share the native ABI. Their boundary requires exported resource summaries or explicit unchecked treatment. Ownership expectations cannot be inferred from the fact that both happen to pass a machine pointer.

# 19. Implementation plan

Each phase has a verifiable completion gate rather than a promised date. Unsupported constructs in a verified region must be rejected until their phase is implemented.

| Phase | Deliverable | Completion gate |
|---|---|---|
| 0. Semantic foundation | Intrinsic registry, target-native types, source maps, stable contract schema | Native declarations retain identity through aliases/imports; target mismatches fail. |
| 1. Native places | Pointer indexing, field access, `addrOf`, inline arrays, layout queries | Typed examples have correct native layout and emit expected address/load/store operations. |
| 2. Basic ResourceFlow | Nullable acquisitions, moves, explicit release, CFG joins, tracked aliases | Core leak, repeated-release, moved-value, and alias use-after-release fixtures pass. Unsupported escapes fail closed. |
| 3. Cleanup | Native `using`, reverse cleanup order, supported exit edges | Every modeled early exit runs each applicable cleanup exactly once; manual-consume conflicts fail. |
| 4. Library contracts | Allocation families, buffer effects, descriptors, conditional `realloc`, source summaries | Outcome-sensitive fixtures distinguish success from failure without losing obligations. |
| 5. Borrow/lifetime refinement | Transparent references, overlapping loans, nonlexical last use, bounded predicate reasoning | Borrow escape/conflict fixtures and selected correlated-branch examples behave as specified. |
| 6. Extended resources | Owning aggregates, nested resource states, callback/thread-lifetime protocols | Each enabled feature has explicit semantics and negative tests before being called verified. |

The simpler native pointer interface does not depend on completing every borrow-checking feature. Likewise, source-level `using` can be useful before sophisticated predicate solving exists. The documentation must state the supported subset at each release.

A compiler-internal verifier SHOULD run after ownership lowering and cleanup expansion. It checks that transformations did not duplicate resource consumption, drop a required cleanup, or erase an unresolved dependency.

# 20. Validation and acceptance criteria

## 20.1 Compiler fixtures

| Test | Expected result in the supported verified subset |
|---|---|
| Allocate, check null, initialize, free | Accept. |
| Allocation failure returns immediately | Accept; no successful-acquisition obligation exists. |
| Missing release on one early return | Reject with the acquisition and exit locations. |
| Explicit release twice | Reject. |
| Release through a copied borrowed alias | Reject as non-owning release. |
| Read through an alias after owner release | Reject with region provenance. |
| Move owner and use original binding | Reject. |
| Return owner to caller that later frees | Accept. |
| Discard returned owner | Reject. |
| Overwrite a live owner | Reject. |
| Register `using` and return early | Accept; exactly one cleanup on that edge. |
| Manually free a `using` binding | Reject under the initial rule. |
| Return a pointer into a `using` allocation | Reject. |
| Return address of a local | Reject. |
| Foreign call captures a stack address beyond return | Reject unless a valid longer-lifetime protocol is established. |
| Unknown FFI effect in verified code | Reject as a proof gap. |
| `realloc` succeeds | Old views invalid; replacement owner may be used and freed. |
| `realloc` fails with positive size | Old owner remains live; failure path must retain or release it. |
| `realloc(p, 0)` in checked profile | Reject until an explicit supported contract is selected. |
| Wrong allocator family or interior pointer | Reject release. |
| Constant fixed-array bounds violation | Reject. |
| Read beyond a successful read's initialized prefix | Reject when initialization/extent checking is enabled. |
| Alias/import name for a consuming function | Same result as its canonical declaration. |
| Forged ownership through `any` or a cast | Reject in checked code. |
| Reused numeric descriptor | Treat acquisitions as different resource identities. |
| Stable complementary branch predicates | Accept only when the supported predicate engine proves them. |
| Predicate changes between branches | Do not reuse the obsolete correlation. |
| Unsupported thread-shared borrow | Reject or require an explicit unchecked boundary. |

## 20.2 Code generation and interoperability

Layout tests compare generated `sizeof`, alignment, field offsets, calling conventions, and selected ABI calls against the target C compiler. Include target-dependent integer types, pointer width, aggregate padding, and opaque native storage. C varargs tests must cover integer promotions, floating promotions, and the exact declared C types used in format calls.

Resource behavior tests instrument the allocator or resource API in a test runtime to count acquisitions, moves as observed through calls, and releases. This is validation instrumentation, not required production machinery.

The same native-resource test suite runs in RC and No-RC modes. Native resource lifecycles must match; only managed-reference operations differ according to the configured policy.

The multifunction example in Appendix A is paired with Appendix B's C reference. Test empty input, whitespace-only input, final words without a newline, tokens spanning chunk boundaries, multiple chunks, allocation failure, open failure, short reads, interrupted reads, read failure, and close failure. Failure injection is necessary for paths ordinary sample files do not exercise.

## 20.3 Analysis evaluation

Track false positives on reviewed valid programs, missed injected bugs within the supported subset, unresolved proofs, unchecked-boundary counts, compile-time cost, memory use, and diagnostic quality. Keep the checking configuration and foreign contracts fixed when comparing results.

A claim of greater path-sensitive acceptance requires an actual equivalent program pair and identical relevant assumptions. A claim of greater safety requires a stated property and a soundness argument for the permitted subset; a higher bug count on a test set is not by itself that argument.

## 20.4 Validation performed for this draft

The C reference in Appendix B was compiled with GCC 14.2.0 using `-std=c11 -O2 -Wall -Wextra -Werror`. Its output matched an independent byte-count/word-count/hash reference on six inputs: empty input, one line, whitespace only, a final word without a newline, a word spanning a chunk boundary followed by multiple chunks, and binary byte values. Missing-file and usage exits were also checked.

Appendix A's native TS source parsed without syntax diagnostics using the locally available TypeScript 5.8.3 parser. This was a syntax check only: native typechecking, ownership checking, ABI lowering, and execution through the proposed compiler were not tested. Allocation/read/close failure injection and concurrency tests remain acceptance work, not claimed completed validation.

# 21. Open decisions for review

The following decisions are intentionally left reviewable rather than presented as conclusions already agreed in the conversation.

| ID | Question | Draft position |
|---|---|---|
| D01 | Should zero-initialized native structs use `{}` or `zeroed<T>()`? | Start with `zeroed<T>()`; consider `{}` only in clearly marked native contexts. |
| D02 | Should a bare native declaration allocate uninitialized storage? | Start with `uninit<T>()`; decide how much stock-TS diagnostic compatibility to retain. |
| D03 | Is `r[0]` acceptable for whole-reference access? | Use it to avoid `.value`/`.set` collisions; retain transparent `r.field`. |
| D04 | Should owner moves be explicit? | Implicit in owning assignments/parameters/returns; an optional `move()` spelling may improve visibility. |
| D05 | Should `addrOf` return only `Ptr<T>`, or infer a reference directly? | Return a pointer and perform a checked temporary-borrow conversion at a suitable call. |
| D06 | How visible should element-pointer borrowing be? | Allow contextual nonescaping borrows and fixed-array decay; keep explicit alternatives available. |
| D07 | Should C string literals convert implicitly? | Start with literal-only `cstr("...")`; implicit literal conversion is optional sugar. |
| D08 | Which `as` conversions should have native conversion semantics? | Explicit native scalar conversion is supported; ownership/lifetime proof cannot be asserted into existence. |
| D09 | Should a `using` owner support early release or moving out? | Initially no; add an explicit cancellation/transfer operation only with complete cleanup semantics. |
| D10 | How are unchecked operations delimited? | Prefer an explicit function/module boundary with an auditable summary; exact spelling remains open. |
| D11 | How strict is the default module profile? | Opt in during migration; select the eventual default only after the supported subset is practical. |
| D12 | Are mutable references essential to the first release? | Native pointers and resource liveness can ship first; exclusive borrowing is a later gated capability. |

The key review question is whether the resulting source remains close to the native operations the programmer intends. The analysis should justify the interface, not require every ordinary field access to become a manually named memory intrinsic again.

# Appendix A. Complete multifunction native TS example

This is the file analyzer discussed earlier, extended to use a dynamically allocated chunk buffer, scoped cleanup, a native descriptor obligation, and borrowed struct parameters. It counts newline bytes and transitions from the defined whitespace set into a word; it is not a Unicode word-segmentation program.

The code below is **proposed native TS**, not an executable stock-JavaScript implementation. It assumes the native prelude and generated Linux bindings described in this RFC. The entry contract supplies valid C `argc`/`argv`; `open`, `read`, `close`, `malloc`, `errno`, and formatting functions carry their selected ABI/resource contracts. Native C strings are borrowed and null-terminated. No wrapper implementation is being hidden in the example.

`scanBuffer`'s proposed precondition annotation means that the specified prefix is within a live, readable, initialized region. Its body is checked under that precondition, and callers must establish it. `addrOf(state)` becomes a temporary `MutRef` borrow in the call context.

```ts
/** @native.layout("c") */
interface Stats {
    bytes: u64;
    lines: u64;
    words: u64;
    hash: u32;
}

/** @native.layout("c") */
interface ScanState {
    stats: Stats;
    inWord: u8;
}

const CHUNK: usize = 4096;

function isSpace(c: u8): boolean {
    return c === 32 || c === 9 || c === 10 || c === 13;
}

/** @native.requires readable(buf, n) */
function scanBuffer(
    buf: Ptr<u8>,
    n: usize,
    state: MutRef<ScanState>
): void {
    for (let i: usize = 0; i < n; i++) {
        const c = buf[i];
        state.stats.bytes += 1n;
        if (c === 10) state.stats.lines += 1n;

        const space = isSpace(c);
        if (!space && state.inWord === 0) {
            state.stats.words += 1n;
        }
        state.inWord = space ? 0 : 1;

        state.stats.hash ^= c;
        state.stats.hash *= 16777619;
    }
}

function analyzeFile(
    path: Ptr<c_char>,
    out: MutRef<Stats>
): c_int {
    const fd = open(path, O_RDONLY);
    if (fd < 0) return -1;

    using buf = malloc(CHUNK) as OwnedPtr<u8> | null;
    if (buf === null) {
        const saved = errno;
        close(fd);
        errno = saved;
        return -1;
    }

    let state = zeroed<ScanState>();
    state.stats.hash = 2166136261;

    for (;;) {
        const n = read(fd, buf, CHUNK);
        if (n === 0) break;

        if (n < 0) {
            const saved = errno;
            if (saved === EINTR) continue;
            close(fd);
            errno = saved;
            return -1;
        }

        scanBuffer(buf, n as usize, addrOf(state));
    }

    if (close(fd) < 0) return -1;
    out[0] = state.stats;
    return 0;
}

function printStats(
    path: Ptr<c_char>,
    stats: Ref<Stats>
): void {
    printf(
        cstr("%s: bytes=%llu lines=%llu words=%llu hash=%08x\n"),
        path,
        stats.bytes as c_ulonglong,
        stats.lines as c_ulonglong,
        stats.words as c_ulonglong,
        stats.hash as c_uint
    );
}

export function main(
    argc: c_int,
    argv: Ptr<Ptr<c_char>>
): c_int {
    if (argc !== 2) {
        puts(cstr("usage: analyzer <file>"));
        return 2;
    }

    const path = argv[1];
    let stats = zeroed<Stats>();
    if (analyzeFile(path, addrOf(stats)) < 0) {
        perror(path);
        return 1;
    }

    printStats(path, addrOf(stats));
    return 0;
}
```

`cstr` accepts literal text and creates static null-terminated bytes in the selected encoding, proposed here as UTF-8. Embedded NUL is rejected by this literal C-string convenience. Converting a dynamic managed TS string is a separate operation with an explicit lifetime; it is not smuggled in through `cstr`.

The explicit `c_ulonglong` and `c_uint` conversions in `printf` are intentional: a native integer width alone does not declare the exact C vararg type expected by a conversion specification. The binding must apply the target's C default argument promotions, and literal format checking is a useful additional diagnostic. The native compiler must preserve those types even when stock TS aliases share a primitive representation.

The hash update uses the draft's wrapping `u32` semantics. The large unsigned counters likewise have defined fixed-width semantics. Neither operation requires managed BigInt arithmetic in this native program.

## A.1 What ResourceFlow sees

Successful `open` creates one descriptor obligation. A failed `open` creates none. Successful `malloc` creates a memory obligation registered with `using`; failure creates none. Every path after a successful open explicitly consumes the descriptor. Every modeled exit after successful allocation executes its registered `free`.

`read` borrows the descriptor and writes a prefix of the buffer. `scanBuffer` borrows that initialized prefix and exclusively borrows the stack state for the duration of the call. The final `out[0]` assignment copies a plain native value; it does not move or duplicate a native resource owner.

## A.2 Manual-cleanup alternative

The same buffer can use manual ownership instead of `using`. Omitting `free(buf)` on an applicable manual-cleanup path is an ownership error:

```ts
const buf = malloc(CHUNK) as OwnedPtr<u8> | null;
if (buf === null) {
    const saved = errno;
    close(fd);
    errno = saved;
    return -1;
}

// Every later return must release buf, or transfer ownership.
// For a read error:
const saved = errno;
close(fd);
free(buf);
errno = saved;
return -1;
```


# Appendix B. Corresponding complete C program

This reference uses the same algorithm and Linux-oriented close/error policy. The explicit cleanup label illustrates the control-flow expansion of the native TS `using` binding. It is a comparison program, not emitted output from an implemented native TS compiler.

```c
#define _POSIX_C_SOURCE 200809L
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>

typedef struct {
    uint64_t bytes;
    uint64_t lines;
    uint64_t words;
    uint32_t hash;
} Stats;

typedef struct {
    Stats stats;
    uint8_t in_word;
} ScanState;

enum { CHUNK = 4096 };

static int is_space(uint8_t c)
{
    return c == 32 || c == 9 || c == 10 || c == 13;
}

static void scan_buffer(
    const uint8_t *buf, size_t n, ScanState *state)
{
    for (size_t i = 0; i < n; ++i) {
        uint8_t c = buf[i];
        state->stats.bytes++;
        if (c == 10) state->stats.lines++;

        int space = is_space(c);
        if (!space && state->in_word == 0)
            state->stats.words++;
        state->in_word = (uint8_t)!space;

        state->stats.hash ^= c;
        state->stats.hash *= UINT32_C(16777619);
    }
}

static int analyze_file(const char *path, Stats *out)
{
    int fd = open(path, O_RDONLY);
    if (fd < 0) return -1;

    uint8_t *buf = malloc(CHUNK);
    if (buf == NULL) {
        int saved = errno;
        (void)close(fd);
        errno = saved;
        return -1;
    }

    ScanState state = {0};
    state.stats.hash = UINT32_C(2166136261);
    int status = -1;
    int saved_error = 0;

    for (;;) {
        ssize_t n = read(fd, buf, CHUNK);
        if (n == 0) break;
        if (n < 0) {
            if (errno == EINTR) continue;
            saved_error = errno;
            (void)close(fd);
            goto cleanup;
        }
        scan_buffer(buf, (size_t)n, &state);
    }

    if (close(fd) < 0) {
        saved_error = errno;
        goto cleanup;
    }

    *out = state.stats;
    status = 0;

cleanup:
    free(buf);
    if (status < 0) errno = saved_error;
    return status;
}

static void print_stats(const char *path, const Stats *stats)
{
    printf(
        "%s: bytes=%llu lines=%llu words=%llu hash=%08x\n",
        path,
        (unsigned long long)stats->bytes,
        (unsigned long long)stats->lines,
        (unsigned long long)stats->words,
        (unsigned int)stats->hash
    );
}

int main(int argc, char **argv)
{
    if (argc != 2) {
        puts("usage: analyzer <file>");
        return 2;
    }

    Stats stats = {0};
    if (analyze_file(argv[1], &stats) < 0) {
        perror(argv[1]);
        return 1;
    }

    print_stats(argv[1], &stats);
    return 0;
}
```

The native TS program and C program are intended to agree on the observable analysis result and modeled resource lifetimes. Verifying the C reference's execution does not establish that the proposed TS front end or ResourceFlow pass has been implemented.

# Appendix C. Prelude and contract sketches

These declarations illustrate the editor-visible shape. They are not a declaration-only implementation of ownership, lvalues, native casts, pointer decay, or native arithmetic inference.

```ts
declare const nativePtrBrand: unique symbol;
declare const nativeOwnerBrand: unique symbol;

interface Ptr<T> {
    readonly [nativePtrBrand]: T;
    [index: number]: T;
    offset(elements: isize): Ptr<T>;
    byteOffset(bytes: isize): Ptr<u8>;
}

type OwnedPtr<T> = Ptr<T> & Disposable & {
    readonly [nativeOwnerBrand]: true;
};

interface FixedArray<T, N extends number> {
    readonly length: N;
    [index: number]: T;
    offset(elements: isize): Ptr<T>;
}

declare function addrOf<T>(place: T): Ptr<T>;
declare function sizeof<T>(): usize;
declare function sizeof<T>(place: T): usize;
declare function alignof<T>(): usize;
declare function zeroed<T>(): T;
declare function uninit<T>(): T;

declare function malloc(bytes: usize): OwnedPtr<void> | null;
declare function free<T>(p: OwnedPtr<T> | null): void;
```

`addrOf`, `sizeof`, and `uninit` demonstrate why the native semantic checker is required: their apparent call signatures cannot enforce addressability, non-evaluation, or uninitialized-state tracking. `Disposable` is an editing projection for native `using`; disposal of the native resource still resolves to the registered cleanup contract.

The `Ref`/`MutRef` declarations must project fields and a whole-value index without pretending that a shallow TS `Readonly<T>` expresses all native alias restrictions. The compiler enforces deep native access permissions and borrow conflicts. The concrete mapped-type projection is an implementation detail to test against the selected TypeScript front end.

Additional metadata, not shown by those declarations, MUST carry allocator families, permitted captures, pointer provenance, out-parameter initialization, C const qualifications, and native calling conventions.

Ordinary source-defined functions may infer no-capture/read/write summaries from checked bodies. Exported or foreign declarations need stable semantic contracts. A source annotation claiming a postcondition is not itself a proof that the body satisfies it.

# Appendix D. Sources and attribution

## Project basis

**[B1] Supplied design note:** `Pasted text(20260905-191702).txt`, 396 rendered file lines, supplied in this conversation. Relevant passages: declarations and memory intrinsics, lines 5–129; echo server, 142–198; worker-pool layout and lifecycle, 241–339; signature generation and pointer representation, 343–396. The subsequent conversation supplies the additional experimental interface and ownership proposals. This RFC's defaults and open decisions are identified separately in Sections 1 and 21.

## External compatibility references

References were consulted on September 5, 2026. They support compatibility statements, not claims that this compiler already implements the proposal. Native ABI behavior remains tied to the selected target and contract version.

**[S1] Microsoft TypeScript — Using the Compiler API.** `Program`, `TypeChecker`, symbol/type queries, and the guide's version scope.  
https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API

**[S2] TypeScript Handbook — Everyday Types.** Type aliases, structural types, and erased assertions.  
https://www.typescriptlang.org/docs/handbook/2/everyday-types.html

**[S3] Microsoft TypeScript — Writing a Language Service Plugin.** Editor integration versus command-line compiler behavior.  
https://github.com/microsoft/TypeScript/wiki/Writing-a-Language-Service-Plugin

**[S4] TypeScript 5.2 release notes.** `using`, `Disposable`, and `Symbol.dispose`.  
https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html

**[S5] Clang Static Analyzer — Source Annotations.** Existing ownership acquisition, taking, and holding annotations.  
https://clang.llvm.org/docs/analyzer/user-docs/Annotations.html

**[S6] LLVM — Opaque Pointers.** Native `ptr` representation and typed memory operations.  
https://llvm.org/docs/OpaquePointers.html

**[S7] Linux man-pages — malloc(3).** Allocation failure, null release, and reallocation behavior, including zero-size caveats.  
https://man7.org/linux/man-pages/man3/malloc.3.html

**[S8] Linux man-pages — read(2).** Return values and short reads.  
https://man7.org/linux/man-pages/man2/read.2.html

**[S9] Linux man-pages — close(2).** Descriptor release and error/retry caveats.  
https://man7.org/linux/man-pages/man2/close.2.html

**[S10] LLVM Language Reference Manual.** GEP, memory operations, alignment, and optimization flags/attributes.  
https://llvm.org/docs/LangRef.html

**[S11] Rust standard library — `std::mem::forget`.** Destructors are not guaranteed to run; forgetting is permitted in safe code.  
https://doc.rust-lang.org/std/mem/fn.forget.html

**[S12] The Rust Programming Language — References and Borrowing.** Rust borrowing rules used for the comparison.  
https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html

**[S13] The Rustonomicon — Send and Sync.** Concurrency guarantees distinct from local resource tracking.  
https://doc.rust-lang.org/nomicon/send-and-sync.html
