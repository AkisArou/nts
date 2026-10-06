# `any` and `unknown` Semantics

Native TypeScript is a typed-first native compiler. It must preserve ordinary TypeScript source syntax where practical, while preventing TypeScript's unchecked escape hatches from becoming memory-unsound native operations.

The compiler therefore distinguishes **TypeScript's checker type** from the **runtime trust and representation** of a value.

Implementation status, 2026-10-03: both ordinary `any` and `unknown` map to
`HirType::Erased`, a 16-byte tagged value. Narrowing through `typeof`, null
tests, `instanceof` and `Array.isArray` can recover supported concrete
representations. Managed references retain their descriptor and counting
information; `unerase.rs` removes redundant erasure. Operations that require
an unproved representation remain named refusals. Giving `any` storage does
not justify arbitrary reads, calls, indexing or arithmetic.

The checker also reports `TypeKind::Evolving` for declarations it has not
settled, such as an initially empty array. Those retain their separate
inference path; treating them as ordinary erased `any` loses useful evidence.

`nts erasure` measures carried, tested, examined and unresolved uses across
the compiled program. It is a classification report, not a proof that a flow
is closed and not a general representation planner. The implementation steps
and validation requirements are in
[`compiler-delivery-plan.md`](compiler-delivery-plan.md).

The sections below describe the intended evidence and boundary contract.
`NeedsRepresentation`, general parameter recovery, structural assertion checks
and boundary materialization describe planned mechanisms unless an implemented
case is explicitly identified. They do not supersede the compiler's current
named boundaries or require a second semantic type system.

## `any`

`any` is not a Native TypeScript runtime type.

It exists only in the TypeScript semantic frontend as an indication that the
TypeScript checker has stopped providing type safety. No `any` type, unresolved
representation variable, or generic dynamic operation may reach HIR or MIR.

The compiler classifies reachable `any` values by provenance.

### What the checker accepts

Native TypeScript does not waive TypeScript errors. If the selected TypeScript
configuration reports an implicit `any`, such as under `noImplicitAny: true`,
the program fails before native representation analysis begins.

```ts
function omitted(value) { // TS7006 when noImplicitAny is enabled
  return value;
}
```

Every `any` that the TypeScript checker *does* accept may enter representation
analysis. This includes:

- explicit TypeScript `any`;
- implicit TypeScript `any` when the project configuration permits it;
- explicit JSDoc `any`;
- implicit values in unannotated JavaScript;
- `any` originating in `lib.*.d.ts`, `@types`, or another declaration file.

The semantic snapshot keeps `TypeKind::Any`, because that is the checker's
answer. Representation planning must separately retain evidence and provenance
for the value. The original design called this state **`NeedsRepresentation`**;
it is a proposed analysis concept, not an implemented source or HIR type.

### Evidence is not a requirement

The representation pass records two different things.

**Evidence** says what a value can be: a literal, a concretely typed flow, a
constructor result, a direct-call argument, a successful narrowing or checked
assertion, or a trusted boundary materialization.

**Requirements** say what an operation needs: the operand semantics of
arithmetic, a property or element layout, a callable target and signature, an
assignment or return ABI, container storage, equality, coercion, or truthiness.

A requirement cannot prove itself. Multiplying an opaque result requires a
number, but writing the multiplication does not prove that the result is one:

```ts
declare function load(): any;

const value = load();
const result = value * 2; // numeric requirement, no numeric evidence
```

This remains a diagnostic unless the declaration has trusted semantics, an
assertion checks the boundary, or another reachable flow proves the value.

By contrast, the direct caller supplies the missing evidence here:

```ts
function twice(value: any) {
  return value * 2;
}

twice(21);
```

The literal supplies a numeric representation and `*` requires numeric
semantics, so the function may lower as
`twice(NumberRep) -> NumberRep`. The same rule applies when the annotation is
JSDoc:

```js
/** @param {*} value */
function twice(value) {
  return value * 2;
}

twice(21);
```

TypeScript's permission to write an operation on `any` is never itself
permission to emit a dynamic operation. Property access must resolve a receiver
layout and member, a call must resolve a target and signature, and coercion must
select semantics for the proven input representations. Otherwise compilation
stops with a representation or operation diagnostic.

### Polymorphic recovery

Direct, statically known calls do not require one representation for every use
of a source function:

```js
function identity(value) {
  return value;
}

identity(42);
identity("hello");
```

When the function does not escape, whole-program analysis may create internal
`identity(NumberRep) -> NumberRep` and
`identity(StringRef) -> StringRef` specializations. The source function's
observable identity remains one; the specializations are compiler-owned call
targets.

A value crossing shared mutable storage, an exported open-world ABI, an
escaping function, or an indirect call instead needs a compatible closed union,
handle, or erased representation. If the selected representation does not also
provide every operation the program performs, the program is refused. There is
no fallback to a universal `any` value.

#### The indirect call, as built (`519195e49`)

For the *indirect call* case that sentence is no longer a requirement to be met
later. A closure reached through a signature rather than through its own class now
has a second entry, `Closure{n}#erased_call`, at a dispatch slot of its own: the
receiver at its own class, then a fixed number of erased parameters, an erased
result. A site holding only the signature spells that and nothing else; the entry
unerases each parameter to what the body declared, erases the result, and answers
`undefined` where the body returns nothing.

**The requirement was not optional and the previous design was unsound about it.**
`Hierarchy::closure_slot` justified one program-global slot on the grounds that "a
call through the slot spells the signature it is making, so two closure types
sharing an index cannot be confused for each other". Spelling the signature *is*
the misread: the site spells what it declared and calls whatever closure it holds.
Counted at the coercion, 25 of `zlib`'s 240 admitted closures disagreed with the
slot they were admitted into, 32 of `http`'s 354, and 22 of `stream`'s 232 — in
three faces, of which the majority (13 of zlib's 25) was a closure returning
nothing whose slot reads a value.

Two indices suffice rather than a table as long as the function-type count: one
index is enough to *dispatch* and not enough to *agree*.

**The width is per program, not universal.** A closure assigned to a signature
declares no more parameters than that signature does, and a body reads no more than
it writes, so the entry is as wide as the widest closure in the program. A universal
width made `benches/cases/closure-merge` marshal nine boxed values per call where
the direct call passed one double.

**Precision is recovered rather than paid for.** Where a pass can name the closure
— a field that can hold exactly one class, a specialised parameter — the call
becomes direct *and the erasure is undone*: the padding dropped, each `Erase`'s
operand taken, the result read at its own type. `benches/cases/optional-chain`
keeps its direct call and its erased entry is pruned as unreachable; 55 of 61
benchmark programs emit byte-identical code. The two programs that keep a uniform
dispatch are the ones where a field genuinely holds more than one class, which is
the case no analysis can resolve.

**What it refuses, and why that is the entry existing rather than missing.** A
closure whose parameters or result have no erased form cannot be reached this way,
and its entry is present and aborts by name. A layout naming a function nothing
defines is worse than an entry that cannot be reached — the same argument
`nts_no_arm` makes for a tag switch with a hole.

#### What it removed, which was not only dead code (`584bb5e64`)

Because no call spells a written signature after this, the pass that reconstructed
one from a call site became unreachable, and `519195e49` deleted
`declare_unfilled_signatures` and `signature_shell`. That was correct, and it is
**not** the pure simplification it was recorded as.

The JVM's Java-callable surface was keyed on the typed `call` slot those functions
declared: a signature class `implements NtsNumberCallback`, a concrete
`call(double)`, a `Fn…$Lambda` so a Java lambda can be passed, and friendly
overloads. All of it vanished silently. The published API became

```text
-public abstract class nts.gen.Fn3__41 implements nts.rt.NtsNumberCallback {
-  public abstract void call(double);
+public abstract class nts.gen.Fn3__41 extends nts.gen.Erased-Callable {
-  public static void eachUpTo(double, nts.rt.NtsNumberCallback);
```

`NtsNumberCallback` is an `interface`, so a Java **lambda** could satisfy it;
extending an abstract class instead means none can. **Six weeks passed** before a
full `tooling/gate/pinned.sh` ran the `interop` step and said so, because no
assembled subset runs it — and the root's name turned out to be unloadable by
`javac` as well, `-` not being a Java identifier, so it is now
`nts/gen/erased/Callable`.

**The general fact, which is the reason this paragraph exists.** A backend receives
only a `Program` and never the snapshot, so it cannot ask the checker for anything
lowering stops publishing; it caches what it is given. "Is this still read?" is
therefore a question about *every crate that receives the artefact*, and grepping
the module the code lives in answers a narrower one. `Program::signature_faces`
(`9d8400ff9`) publishes the fact explicitly instead, with `None` at a position whose
Java face cannot be typed — distinct from an absent key, which means "not a written
signature" — so the consumer names what it cannot express rather than dropping the
surface.

### Declaration-originated `any`

Native TypeScript does not modify upstream `lib.*.d.ts`, `@types/node`, or third-party declarations merely to replace `any` with `unknown`.

A value originating from an `any` declaration follows the same
`NeedsRepresentation` flow, with declaration provenance retained for
diagnostics and trusted-boundary lookup.

For example:

```ts
const value = JSON.parse(text);
```

The expression continues to have the ordinary TypeScript checker type `any`, but Native
TypeScript separately records that the value has not yet acquired a statically
safe executable representation.

Such values may:

- be explicitly quarantined as `unknown`;
- flow through operations whose semantics are known to Native TypeScript;
- be asserted to a static type;
- remain in erased type-only positions.

They may not be used for unrestricted dynamic operations. Assigning one to a
typed destination imposes a requirement; it does not prove that the source has
the destination's representation. Analysis must prove compatibility or an
explicit assertion must perform the required check.

This allows Native TypeScript to consume the existing TypeScript ecosystem without redefining its declaration files or silently introducing dynamic JavaScript semantics.

## `unknown`

`unknown` is a fully supported static top type.

Unlike `any`, `unknown` is safe: every value may flow into it, but concrete operations require narrowing or an assertion.

`unknown` may appear in:

- locals;
- parameters;
- return values;
- class fields;
- record and tuple fields;
- arrays;
- maps and sets;
- closures;
- module state.

The compiler must not reject `unknown` merely because it requires an erased representation.

```ts
class Message {
  payload: unknown;
}

const values: unknown[] = [];
```

Such storage may have a representation cost, but it is valid source code.

## Runtime representation of `unknown`

`unknown` and `NeedsRepresentation` share the same whole-program representation
planner, but they do not have the same source-language semantics. `unknown` is
safe and requires narrowing before concrete operations. Checker-accepted `any`
allows those operations syntactically, so Native TypeScript must legalize each
one from independent representation evidence before lowering it.

`unknown` does not imply one universal boxed representation.

The compiler performs whole-program representation analysis and selects the cheapest representation consistent with all reachable uses.

An `unknown` value may lower to:

- a direct primitive;
- a managed reference;
- a closed union;
- a platform handle;
- or a general erased-value representation.

For example:

```ts
function increment(value: unknown): number {
  if (typeof value === "number") {
    return value + 1;
  }
  return 0;
}
```

may compile to ordinary numeric code when all reachable callers provide numbers.

Programs that never require general erased storage should not pay for a general erased-value runtime.

### A measurement, from the Node profile

The Node session read — rather than counted — all **174 `unknown` parameters**
across thirteen `node:*` modules, and the distribution is the argument for doing
this by whole-program analysis rather than by a rule:

| | sites | what happens to the value |
| --- | ---: | --- |
| **carried** | 56 | `...args: unknown[]` through `console`, `events`, `diagnostics_channel`; 39 variadic. Stored in an array and passed on. Nothing at the site looks at it. |
| **examined** | 55 | `inspect`, `format`, deep equality, and `util/types`' 36 predicates. Full generality. |
| **tested** | 10 | the validators: `typeof value !== "string"` and throw. |
| the rest | ~53 | `assert`'s comparison and message machinery, mostly examined. |

Two things follow, and the first is the one this section exists for.

**The cheapest representation for `console`'s `unknown` is decided by a use that
is not in `console`.** `log(...args: unknown[])` only moves its arguments — a
boxed pointer would do — and it is `formatWithOptions` in `node:util`, a
different module, that examines them. No per-module or per-signature rule can
see that. This is the whole-program case as a worked example rather than as a
principle.

**And the closed-union case does not rescue even the validators**, which look
like the easiest ten sites:

```ts
export function validateString(value: unknown, name: string): void {
  if (typeof value !== "string") {
    throw new ERR_INVALID_ARG_TYPE(name, "string", value);   // still open here
  }
}
```

The *test* narrows and the value flows on as a `string`. The **throw** passes the
still-open value to a general renderer — `typeof` dispatch across every kind,
`String(value)`, `value.constructor.name`, `JSON.stringify`, `inspect`. So
`unknown` reaches a type test *and* a general renderer, and the renderer is on
the path the validator exists to take. `validateOneOf` is worse:
`oneOf.includes(value)` is `===` between two erased values.

### One capability that might be cheaper than erasure

All 36 predicates in `util/types.ts` go through one function:

```ts
function brand(value: unknown, probe: (v: never) => unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  try { probe(value as never); return true; } catch { return false; }
}
```

These sites never *read* the value. They call a known built-in prototype method
on it and observe whether it threw. If "call a known method and catch" is
cheaper to support than general erasure, it takes a fifth of the examined sites
out of the hard case — worth checking before assuming the 55 all need the same
representation.

### The caveat that matters

"Carried" versus "examined" is a **reachability question over uses**, which is
precisely the analysis this section specifies. The table above is one person's
reading of one program, and it is evidence about the shape of the problem rather
than an input to the algorithm. When this is built, the compiler should produce
that table itself.

### It does now — `nts erasure`, and where it disagrees

`nts_core::erasure` produces the table, and `docs/records/0019` reports what it
says. Over the whole profile compiled as one project, at `a347b67`, 566 `unknown`
parameters: 227 carried, 83 tested, 185 examined, 71 unclear.

Two corrections to the reading above.

**`tested` is 15%, not 6%.** The hand count treated it as too small to matter.
The difference is that a read of a value *after* narrowing is not a read of the
erased value: `value + 1` inside a `typeof` guard reads a `number`. Counting it
as an examination of the `unknown` is what collapses the two categories, and the
checker's own type at the use site already distinguishes them. So **55% of
`unknown` parameters need only a pointer or a tag**, not the ~32% implied here.

**The whole-program argument is stronger than stated, and in a different
direction.** 99 of 566 parameters are answered differently once calls are
followed, 34 of them by a use in another file — and every disagreement runs the
same way, from carried to examined. A per-signature rule is not merely
incomplete; it is *optimistic*, and a representation chosen from it would be too
small. The `console`/`node:util` example is reproduced exactly by the pass,
including `log(...args)` through its spread.

## Narrowing

`unknown` supports ordinary TypeScript narrowing operations whose semantics Native TypeScript can implement statically and safely, including:

```ts
typeof value === "string";
typeof value === "number";
typeof value === "boolean";

value === null;
value === undefined;

value instanceof SomeClass;

Array.isArray(value);
```

After successful narrowing, the compiler uses the narrowed representation directly where possible.

Unnarrowed `unknown` does not permit arbitrary property access, calls, indexing, or arithmetic.

## `as T`

Native TypeScript keeps ordinary TypeScript assertion syntax:

```ts
const user = value as User;
```

but assertions are checked when required for native representation safety.

A failed native check raises a `TypeError` through an available handler or
raising entry. At an unhandled entry it reports a named runtime refusal. This
keeps an incompatible payload from reaching a native load without presenting
the added safety failure as the JavaScript program's result. Non-null
assertions follow the same rule where their target is a reference, which the
program would otherwise dereference; a scalar `x!` stays the type-only claim it
is in JavaScript (`undefined` read as a number is NaN).

The compiler selects the cheapest valid lowering.

### Proven assertion

If analysis already proves the value has type `T`, the assertion is removed.

```text
cost: zero
```

### Existing native representation

If the value is already a Native TypeScript runtime value, `as T` checks whether its existing representation is compatible with `T`.

For classes this may be a nominal type-descriptor check.

For structural records it may be a canonical shape-descriptor check.

For typed containers it may be an element-layout descriptor check.

```text
cost: normally O(1)
allocation: none
identity: preserved
```

An assertion over an already-materialized native object must never silently construct a different object merely because its fields appear structurally compatible.

Object identity and mutation semantics must be preserved.

## Boundary materialization

Some APIs inherently deserialize, clone, persist, or transport values through a generic representation.

Examples include:

- JSON parsing;
- HTTP response JSON;
- structured-clone messaging;
- worker messages;
- IndexedDB values;
- persistent key/value stores;
- generic IPC;
- database rows.

When an `as T` directly consumes such a recognized boundary, the compiler may specialize the boundary operation to materialize `T` directly.

For example:

```ts
const user = JSON.parse(text) as User;
```

may lower to:

```text
JSON bytes
    ↓
generated parser for User
    ↓
native User representation
```

rather than:

```text
JSON bytes
    ↓
generic object graph
    ↓
second structural traversal
    ↓
native User representation
```

This optimization is permitted only when the source operation already has fresh-value, serialization, cloning, or transport semantics.

It must not be applied to an arbitrary existing native object.

## Trusted boundary semantics

The compiler core does not recognize APIs by hardcoded names such as:

```text
JSON.parse
Body.json
MessageEvent.data
IDBObjectStore.get
```

Instead, standard-library and platform profiles associate trusted declaration identities with a small closed set of compiler-owned boundary semantics.

Conceptually:

```text
JsonParse
StructuredCloneSend
StructuredCloneReceive
PersistentStoreRead
PersistentStoreWrite
TypedTransportSend
TypedTransportReceive
RowMaterialize
```

The TypeScript declaration files themselves remain unmodified.

A profile may identify that the upstream declaration corresponding to `JSON.parse` implements the `JsonParse` boundary, while the compiler core only understands `JsonParse`.

This keeps platform knowledge outside the core compiler while still allowing strong optimization.

Third-party libraries do not receive trusted boundary behavior automatically.

If a third-party API returns `any`, Native TypeScript treats it as an ordinary unchecked declaration value unless the package or selected profile explicitly provides trusted semantic metadata.

## Native TypeScript-owned APIs

APIs owned by Native TypeScript should avoid `any` and `unknown` when the result type is statically known.

For example, a native module should expose:

```ts
export interface Preferences {
  theme: string;
  fontSize: number;
}

export interface PreferencesModule {
  read(): Promise<Preferences>;
  write(value: Preferences): Promise<void>;
}
```

rather than:

```ts
read(): Promise<unknown>;
```

The ordinary TypeScript interface is the schema.

The compiler derives platform ABI, transport, and materialization code from the TypeScript type itself.

No secondary runtime type DSL is required.

## Summary

The intended model is:

```text
checker-accepted any
    ↓
frontend-only unchecked provenance
    ↓
NeedsRepresentation
    ↓
representation evidence + operation requirements
    ├── proven
    │       → concrete specialization / supported union / handle
    └── unresolved
            → diagnostic
    ↓
never reaches HIR or MIR as any


unknown
    ↓
safe static top type
    ↓
narrow / assert / store opaquely
    ↓
representation selected by analysis


as T
    ├── already proven
    │       → zero cost
    │
    ├── existing native value
    │       → O(1) representation check
    │
    ├── trusted serialization boundary
    │       → specialize/materialize directly as T
    │
    └── incompatible
            → diagnostic or checked TypeError
```

The guiding principle is:

> `any` is a loss of static trust, not a native value type. It may enter
> representation recovery, but neither its representation nor its operations
> are trusted. `unknown` is a safe top type, not a dynamic language. Assertions
> establish a native representation; trusted data boundaries may be specialized
> so that generic intermediate values never need to exist.
