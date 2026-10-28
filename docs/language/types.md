# Types

What a static type means at run time in a program nts compiles. In nts a type
is a promise about representation, and the compiler holds the program to it.
This page is for anyone writing TypeScript for nts: which types become which
values, what `any` and `unknown` are, what `as` does, how interfaces are
satisfied, which compiler settings nts requires, and what happens when a type's
claim is false at run time. How each value is laid out and what it costs is
[foundations/objects.md](../foundations/objects.md); numbers have their own
page, [numbers.md](numbers.md).

## A type is a layout

TypeScript's checker runs first, and a program that does not type-check does
not compile. Then each static type decides how its values are held:

| The static type | What a value of it is |
|---|---|
| `number` | a double, or an integer where the compiler proves every value whole and in range ([numbers.md](numbers.md)) |
| `boolean`, `bigint` | the value itself; a `bigint` is a 128-bit integer ([numbers.md](numbers.md#bigint)) |
| `string`, `symbol` | a reference to an immutable value |
| a class, an interface, an object type | a reference to a flat struct whose fields sit at fixed positions |
| an array, or a tuple whose elements share one type | an array of that element type |
| a tuple whose elements differ | a struct with positional fields |
| an index signature (`Record<string, V>`) | a table keyed by string |
| `Map`, `Set` | an insertion-ordered table |
| `T \| null` or `T \| undefined`, where `T` is a reference | a reference that may be absent |
| `any`, `unknown`, `object`, a union of different representations, an optional property | an erased value (below) |

Types that only describe other types add nothing at run time: aliases,
intersections, mapped, conditional and indexed-access types, `keyof`, `typeof`
and template literal types compile to what they resolve to. `readonly` is a
type-level fact: it does not freeze the object.

Generics are copied: a generic function or class is compiled once for each
set of type arguments the program uses, written or inferred, and each copy has
its own layouts. A generic nothing instantiates has no copy: an exported
generic function the program never instantiates is refused, and an
uninstantiated generic class is refused member by member, so a library
compiled alone cannot export its generics. Polymorphic recursion
(`class Node<T> { next: Node<Node<T>> }`) is followed to a fixed depth and
refused past it. Whether an erased fallback copy should exist is register
[L9](../open-questions.md#1-language-and-compiler).

## Erased values: `any` and `unknown`

`any` and `unknown` have no layout of their own. A value of either type is an
**erased value**: a tag saying what kind of value it holds, and the value. The
tags are spelled as `typeof` answers, plus `null`, host handles and BigInt. On
native targets an erased value is a 16-byte tagged value, a 4-byte tag and an
8-byte payload (`NtsValue`;
[foundations/objects.md](../foundations/objects.md#dynamic-values)); the JVM
and Wasm forms are in
[foundations/jvm-and-wasm.md](../foundations/jvm-and-wasm.md).

An erased value goes anywhere a value can: locals, parameters, returns,
fields, array elements, `Map` and `Set` entries, closures and module state.
What a program can do with one:

- **Carry it.** Passing and storing never look inside.
- **Test it.** `typeof v`, `v === null`, `v === undefined`, `v instanceof C`,
  `Array.isArray(v)` and `"k" in v` read its tag or its class.
- **Recover it.** After a test narrows it, the narrowed value is read at its
  concrete representation with no further check: the test licensed the read.
- **Assert it.** `v as T` checks at run time where it must (next section).

`unknown` keeps TypeScript's rules: no member read, call, index or arithmetic
before narrowing. `any` permits those in the source, and nts does not take that
as permission: every operation on an `any` value needs a representation the
compiler can prove from a literal, a call, a narrowing or an assertion.
Otherwise the construct is refused by name, as in
``NTS1001 `k` on `any`, which is erased here``. A member read on an erased
value by a key known only at run time is refused today; it is decided to read
through a table of member names per type ([Decisions](#decisions)).

The compiler removes erasure a program does not need. A value erased and then
recovered in one function keeps its concrete form, and an erased array whose
every store holds one representation is stored as that representation.
`nts erasure` reports, for a compiled program, which erased uses only carry
their value, which test it and which read it.

## Casts

`as` is TypeScript's assertion, and node erases it. nts erases it too wherever
a wrong claim cannot make the program read a value at the wrong
representation, and checks it where it can:

| The cast | What nts does |
|---|---|
| between concrete types: an upcast, a class to an interface it satisfies | nothing at run time; the value keeps its identity |
| an erased value to `number`, `string`, `boolean`, `bigint` or `symbol` | tests the tag |
| an erased value to a class | tests the class, as `instanceof` against it and its subclasses |
| an erased value to an interface or an object type | no test at the cast; a field access through the result compiles only where every class the value could be supplies that field, and is refused otherwise |
| `x!` where `x` is a reference | tests for `null` and `undefined` |
| `x!` where `x` is a number or another scalar | nothing: as in JavaScript, `undefined` read as a number is `NaN` |
| `n as Uint16` and the other scalar kinds | proven at compile time or refused; nothing at run time ([numbers.md](numbers.md)) |
| `satisfies`, `as const` | nothing at run time |

A failed test throws a `TypeError` ("The asserted native representation does
not match the value", or "... native class ...") where the function can carry
a throw to a handler: inside a `try` in the same function, in an `async`
function, or in the copy nts compiles of a function called inside a `try`
([errors.md](errors.md#how-a-throw-travels)). Anywhere else the program stops
by name, printing `nts: refused: The asserted native class does not match the
value` and exiting with status 1. Either way the program never reads a payload as something it is
not. A failed test is decided to be a catchable `TypeError` everywhere
([Decisions](#decisions)); the stop by name remains until every throw can
reach its handler.

## Interfaces are satisfied by shape

TypeScript is structurally typed: a class satisfies
`interface S { go(): number }` by having a `go`, and `implements S` is
optional. nts sees the whole program, so it finds every class that fits each
interface, by member name and with a signature the interface's slot can carry.
A call through the interface dispatches to the method of the value's own
class, written `implements` or not, in one indexed load.

A class passed where an interface is wanted is usually not cast at all: the
callee is compiled again for that class, so its accesses are direct (record
[0294](../records/0294-remove-the-dispatch-rather-than-predict-it.md)).

Fields are where structure and layout part. A field read through an interface
goes to the interface's position when the object's class is known or every
implementing class holds the field there. Where the class is lost, because the
value came from an erased value or from a join of classes, and the implementing
classes hold the field at different positions, the access goes through a getter
or setter entry each class fills. An access that cannot be given one tests the
object's class and stops by name for a class that holds the field elsewhere,
rather than read the wrong field. How the dispatch tables and entries are built
is [foundations/objects.md](../foundations/objects.md#interfaces-satisfied-by-shape).

## Compiler settings

nts reads the program's `tsconfig.json` and depends on some of its settings:

| Setting | What nts requires | What happens otherwise |
|---|---|---|
| `strict` | every strict setting on in effect, through `strict` or individually | `NTS1006`, naming each disabled setting and its configuration file when available |
| `useDefineForClassFields` | `true`, class fields with define semantics | ``NTS1001 class field `x` needs useDefineForClassFields: true (effective false)`` at the first emitted field |
| `experimentalDecorators`, `emitDecoratorMetadata` | `false` | ``NTS1001 a decorator needs experimentalDecorators: false (effective true)`` at the first decorator |

Compilation requires `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`,
`strictBindCallApply`, `strictPropertyInitialization`,
`strictBuiltinIteratorReturn`, `noImplicitThis`, `useUnknownInCatchVariables`
and `alwaysStrict`. The effective values decide acceptance; the `strict`
switch itself may be false if every setting is true. The native checker
defaults `alwaysStrict` to true independently of its strict group and reports
an explicit false as a removed option. nts also requires its captured effective
value to be true. Missing configuration provenance never waives a setting.
Frontend-only inspection and diagnostic audits report the native checker's
results without imposing this compilation policy.

The class-field and decorator checks are made at a construct whose meaning the
setting changes, so a project with no class fields may leave
`useDefineForClassFields` false. The
compiler also records `verbatimModuleSyntax`, `preserveConstEnums` and
`isolatedModules`, and refuses nothing over them.

## When a type's claim is false at run time

TypeScript's types are unsound in known places, and a layout built from a false
claim reads the wrong bytes. Today's behaviour, case by case:

| The case | node | nts today | Question |
|---|---|---|---|
| an index past the end of an array the type says is full | `undefined` | stops by name: `nts: refused: index 5 is outside [0, 3)` | L4, [decided](#decisions) |
| a hole in a `number[]` or `boolean[]` (`new Array(n)`, a slot never written) | `undefined` | reads as `0` or `false` on C (`tests/outcomes/a-hole-in-an-array-of-numbers-reads-as-zero`) | L4 |
| a field declared `x!: T` and never written | `undefined` | reads as a zero value (`tests/outcomes/a-required-field-with-no-initializer-starts-as-undefined`) | L4 |
| a `var` read before its assignment | `undefined` | at module scope a wrong answer (`tests/outcomes/a-var-read-before-its-declaration`); through a closure, a stop by name | L4 |
| a `Sub[]` widened to `Base[]`, then given a `Base` | the `Base` behaves as a `Base` | widening between different element layouts is refused (NTS1001) on every backend; between equal layouts, C and LLVM call the `Base` as a `Sub` (`tests/outcomes/a-base-pushed-through-a-covariant-array-dispatches-as-the-subclass`), and the JVM declines (NTS4001) | [L5](../open-questions.md#1-language-and-compiler) |
| an erased value asserted to the wrong type | reads on | `TypeError` or a stop by name (casts, above) | L6, [decided](#decisions) |
| a `this` that is not the declared `this:` type | reads on | stops by name ([functions.md](functions.md#this)) | L14, [decided](errors.md#decisions) |

**The policy:** every case in this table behaves as node does, with one
exception. An erased value asserted to a type it does not have throws a
catchable `TypeError`, as the cast table above describes; the stop by name
remains only until a throw through any call can reach its handler (L15,
[errors.md](errors.md#decisions)). Reads that JavaScript answers with
`undefined` give `undefined`, by a representation that marks the slots not
proved written (X1 in [the JVM and Wasm](../foundations/jvm-and-wasm.md#proposed-decisions)).
Until each case meets the policy, a wrong answer that runs is recorded under
`tests/outcomes/`.

## Decisions

- **A program compiles only under `strict`:** every flag `strict` turns on
  must be on in effect, set through `strict` or one by one, and a project with
  one off is refused, naming it (10-28,
  [log](../records/notebooks/decisions-log.md#compiler-settings-10-28)).
  Not built yet.
- **When a type's claim is false at run time, nts behaves as node does, with
  one exception:** an erased value (from `any`, `unknown`, JSON or foreign
  code) asserted to a type it does not have throws a catchable `TypeError`
  (10-27, [log](../records/notebooks/decisions-log.md#language-and-hosts-10-27)).
- **A member read on `any` or `unknown` by a key known only at run time** goes
  through a table of member names per type, found through the value's
  run-time descriptor, while typed code stays direct; it is what untyped JSON
  and npm JavaScript need (L7; 10-28,
  [log](../records/notebooks/decisions-log.md#language-10-28)). Not built.
- `JSON.parse(text) as T` that does not match `T` is a `TypeError` naming the
  JSON path; invalid JSON is a `SyntaxError` first; a class as `T` is refused
  for now, plain object types only (10-22,
  [Numbers and JSON](../records/notebooks/decisions-log.md#numbers-and-json-10-22)).
  Not built: `JSON.parse` is not provided yet (NTS1100).
- Acyclic types are proved by the compiler, never declared, and the language
  has no memory annotations (10-23, M5,
  [Memory and vendored code](../records/notebooks/decisions-log.md#memory-and-vendored-code-10-22-10-23),
  [Memory management](../records/notebooks/decisions-log.md#memory-management-10-27)).
- Interfaces are satisfied by shape across the whole program, with interface
  fields as accessor entries where layouts disagree and a named stop until then
  (2026-10-10, recorded in
  [interfaces-by-shape](../records/notebooks/interfaces-by-shape.md#decided-2026-10-10-all-three-as-recommended)).
