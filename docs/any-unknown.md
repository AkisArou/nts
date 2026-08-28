# `any` and `unknown` Semantics

Native TypeScript is a typed-first native compiler. It must preserve ordinary TypeScript source syntax where practical, while preventing TypeScript's unchecked escape hatches from becoming memory-unsound native operations.

The compiler therefore distinguishes **TypeScript's checker type** from the **runtime trust and representation** of a value.

## `any`

`any` is not a Native TypeScript runtime type.

It exists only in the TypeScript semantic frontend as an indication that the TypeScript checker has stopped providing type safety. No `any` type or generic dynamic-operation representation may reach MIR.

The compiler classifies reachable `any` values by provenance.

### Application `any`

Explicit or implicitly inferred `any` in reachable application code is rejected by default.

```ts
let value: any; // error
```

This includes arbitrary property access, invocation, indexing, arithmetic, and other operations whose correctness depends only on TypeScript's `any` escape hatch.

### Declaration-originated `any`

Native TypeScript does not modify upstream `lib.*.d.ts`, `@types/node`, or third-party declarations merely to replace `any` with `unknown`.

A value originating from an `any` declaration is instead tracked internally as **unchecked**.

For example:

```ts
const value = JSON.parse(text);
```

continues to have the ordinary TypeScript checker type `any`, but Native TypeScript separately records that the value has not yet acquired a statically safe executable representation.

Unchecked values may:

- be explicitly quarantined as `unknown`;
- flow through operations whose semantics are known to Native TypeScript;
- be asserted to a static type;
- remain in erased type-only positions.

They may not be used for unrestricted dynamic operations.

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
any
    ↓
frontend-only unchecked provenance
    ↓
must be quarantined, asserted, or eliminated
    ↓
never reaches MIR


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

> `any` is a loss of static trust, not a native value type. `unknown` is a safe erased type, not a dynamic language. Assertions establish a native representation; trusted data boundaries may be specialized so that generic intermediate values never need to exist.
