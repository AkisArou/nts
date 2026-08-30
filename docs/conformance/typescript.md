# TypeScript language and runtime conformance

What compiles, what is refused, and what is missing entirely.

Companion to [`nodejs.md`](nodejs.md), which tracks the Node API surface, and to
[`test262.md`](test262.md), which tracks the numeric slice of the ECMAScript
suite. This file is the *language* and the *runtime under it*.

Two things it is deliberately not. It is not a conformance claim against
ECMA-262: this compiles a *typed* language ahead of time, and §13 sets out the
part of the specification that is a non-goal rather than a gap. And it is not a
plan — §15 is the plan, and it is ordered by what real code is refused for
rather than by what looks incomplete.

## How this was derived

From probes, not from memory. Each row below was compiled by `nts hir` as one
exported function, and the lowering reports one diagnostic per function — so a
file of thirty functions answers thirty questions in one run.

Two mistakes are easy here and both were made while writing this:

- **A file that does not typecheck probes nothing** and every row reads as
  supported. Check for `does not typecheck` before believing a green column.
- **A declaration nested inside a function body is refused for being nested**,
  not for being what it is. `class C {}` inside a function says `this
  statement`; the same class at the top level lowers. Probe at the top level.

The independent measures are `tooling/gate/all.sh`: the corpus (184 files of
TypeScript's own tests), the examples (73 programs run against node case by
case), and the node profile (110 files, measured for *reach* — nothing runs it).

## Legend

| | |
|---|---|
| ✅ | lowers, and where it is observable the examples agree with node |
| ◐ | partial — the shape works, some of the surface does not |
| ✗ | a **gap**: refused today, wanted eventually |
| ∅ | **not a goal** — see §13, and the reason it is there |

`✗` and `∅` are both refusals at the compiler. The difference is whether
anybody should ever fix it, and conflating them turns a list of decisions into
a backlog.

---

## 1. Expressions and operators

| | | |
|---|---|---|
| ✅ | arithmetic | `+ - * / % **` |
| ✅ | bitwise | `& \| ^ ~ << >> >>>` |
| ✅ | comparison, equality | `< > <= >= == != === !==` |
| ✅ | logical | `&& \|\| !` |
| ✅ | unary | `+x -x`, `++ --` prefix and postfix |
| ✅ | compound assignment | `+= -= *= /= %= **= &= \|= ^= <<= >>= >>>=` |
| ✅ | conditional | `c ? a : b`, nested |
| ✅ | `typeof` | folded on a known primitive; a tag read on an erased value |
| ✅ | template literals | including interpolation |
| ✅ | object and array literals | shorthand, computed keys, quoted keys |
| ✅ | member access | `o.x`, `o["x"]`, `o[0]` |
| ✅ | `new` | user classes, `Array`, typed arrays |
| ✅ | `??` | the absence test, not the truthiness one — `0 ?? 1` is `0` |
| ✗ | `??=`, `\|\|=`, `&&=` | |
| ✅ | `?.` | one link; a chain after an optional access is refused and named |
| ✗ | `?.()`, `?.[]` | optional call and optional index |
| ✗ | spread | `[...a]`, `{...o}` |
| ✗ | `in`, `delete`, `void`, comma | |
| ✗ | `instanceof` | needs a class as a value |
| ✗ | tagged templates | |

## 2. Statements and control flow

| | |
|---|---|
| ✅ | `if`/`else`, `switch` including fall-through |
| ✅ | `for`, `while`, `do`/`while`, `for...of` over an array |
| ✅ | `break`, `continue`, `return`, `throw` |
| ✅ | block scope, `const`/`let`/`var` |
| ✅ | destructuring: object, array, nested, rest element |
| ✗ | `try`/`catch`/`finally` — no unwinding mechanism yet |
| ✗ | labelled `break`/`continue` |
| ✗ | `for...in` |
| ✗ | `for...of` over a string |
| ✗ | a default inside a destructuring pattern |

## 3. Functions

| | |
|---|---|
| ✅ | declarations, arrow functions (both body forms), IIFE |
| ✅ | optional parameters, default parameters |
| ✅ | overload signatures |
| ✅ | generics, including constrained; monomorphized per instantiation |
| ✅ | higher-order functions and closures that only *read* what they capture |
| ✅ | recursion |
| ✅ | `async`/`await` |
| ✅ | type predicates (`x is T`) and `asserts x is T` |
| ✗ | rest parameters |
| ✗ | `function` expressions — an arrow with the same body lowers |
| ✗ | closures over a variable something **assigns to** — this captures by value and JavaScript by reference |
| ✗ | generators (`function*`, `yield`) — needs the `Generator<T>` object |

## 4. Classes and objects

| | |
|---|---|
| ✅ | fields: public, `readonly`, `private`, `protected`, `static`, `#private` |
| ✅ | field initializers, constructors |
| ✅ | methods, `get`/`set` accessors, `static` methods |
| ✅ | inheritance, `override`, `super`, virtual dispatch |
| ✅ | `abstract` classes and their implementations |
| ✅ | `implements` |
| ✅ | member names: bare, quoted, `["bracketed"]`, `[0]` |
| ✅ | extending a typed array when the subclass adds no storage |
| ✗ | parameter properties (`constructor(public x: number)`) |
| ✗ | `abstract` **methods** — the class works, the declaration is refused |
| ✗ | generic classes |
| ✗ | a class used as a *value* (`C` itself, `instanceof C`) |
| ✗ | methods and getters on **object literals** |
| ✗ | a member name the program computes (`[kSymbol]`) — wants a property map |

## 5. Modules

| | |
|---|---|
| ✅ | `import { x }`, `import { x as y }`, `import type` |
| ✅ | `import * as ns` and members through it |
| ✅ | `export`, `export { x as y } from`, `export *` |
| ✅ | evaluation order rooted at the entry module, matching node |
| ✅ | cycles: self, three-way, crossed by a function, re-export, late read |
| ✅ | the temporal dead zone as a **compile-time** error (NTS1004) |
| ✅ | module-scope state, including references |
| ✗ | `import def from` — default imports |
| ✗ | dynamic `import()` |
| ✗ | a module-scope variable holding a function |

## 6. The type system

Types are erased: they decide representation and then stop existing. Nearly all
of the surface therefore costs nothing.

| | |
|---|---|
| ✅ | aliases, unions, intersections, literal types, tuples |
| ✅ | optional and `readonly` properties, index signatures |
| ✅ | mapped, conditional, indexed-access, `keyof`, `typeof`, template literal types |
| ✅ | function and constructor types |
| ✅ | `interface`, including `extends` |
| ✅ | `as`, `satisfies`, `as const`, `!` |
| ✅ | `namespace` |
| ✅ | `declare` (ambient) |
| ✅ | `enum` |
| ✗ | `const enum` |
| ✗ | decorators |

## 7. Values and representation

| | |
|---|---|
| ✅ | `number` (f64, narrowed to `i32`/`u8`… where proven) |
| ✅ | `boolean`, `string` |
| ✅ | arrays, tuples that share an element type |
| ✅ | objects — a flat struct with a layout |
| ✅ | typed arrays: all eight kinds, as `NtsArray` with a narrow element |
| ✅ | `unknown`, `any` sites, unions, optional properties — one 16-byte tagged value |
| ✅ | `null`/`undefined` where a reference can hold them |
| ✗ | `bigint`, `symbol` |
| ✗ | heterogeneous tuples — need positional layout |

## 8. ECMAScript globals

The whole global object, host additions excluded. `∅` rows are §13, not backlog.

| group | ✅ | ✗ gap | ∅ not a goal |
|---|---|---|---|
| value properties | `Infinity`, `NaN`, `undefined` | | `globalThis` |
| function properties | `isNaN`, `isFinite` | `parseInt`, `parseFloat`, `encodeURI(Component)`, `decodeURI(Component)` | `eval` |
| fundamental | `String` (as a function), `Number` | `Object` ◐, `Boolean`, `Symbol` | `Function`, `Proxy`, `Reflect` |
| errors | `Error`, `TypeError`, `RangeError`, `URIError` | `ReferenceError`, `SyntaxError`, `EvalError`, `AggregateError`, `SuppressedError` | |
| numbers, dates | `Math` ◐, `Number` ◐ | `BigInt`, `Date` | |
| text | `String.prototype` ◐ | `RegExp` | |
| indexed | `Array` ◐, eight typed arrays ◐ | `Array` statics, `Uint8ClampedArray`, `Float16Array`, `BigInt64Array`, `BigUint64Array` | |
| keyed | | `Map`, `Set`, `WeakMap`, `WeakSet` | |
| structured | | `ArrayBuffer`, `DataView`, `JSON`, `Atomics`, `SharedArrayBuffer` | |
| memory | | `WeakRef`, `FinalizationRegistry` | |
| control | `Promise` ◐ | `Iterator`, generator objects | |
| internationalization | | | `Intl` — ECMA-402, a separate specification |

### `Object` is two halves

They belong in different columns and putting them in one is what made this
table read as a backlog:

- **A gap.** `keys values entries assign fromEntries hasOwn is groupBy` — these
  want a hash table and a defined enumeration order, both of which a compiled
  program can have.
- **Not a goal.** `defineProperty getOwnPropertyDescriptor(s) create
  getPrototypeOf setPrototypeOf freeze seal preventExtensions isFrozen isSealed
  isExtensible`, and `Object.prototype`'s methods. Each needs a property map
  and a prototype chain at run time; see §13.

### ES2026 additions, and the oracle's ceiling

The examples gate compares against node, so an addition node does not have is
one this compiler cannot differentially test. Measured against node 24:

| in node, testable | not in node yet |
|---|---|
| `Error.isError`, `RegExp.escape`, `Iterator.from`, `Map.groupBy`, `Object.groupBy`, `Promise.try`, `Promise.withResolvers`, `Math.f16round`, `Set` composition (`union` and the rest), `Array.fromAsync`, `Array.prototype.with`/`toSorted`/`toSpliced`/`toReversed`, `JSON.rawJSON`, `Float16Array`, `String.prototype.isWellFormed` | `Iterator.concat`, `Map.prototype.getOrInsert(Computed)`, `Math.sumPrecise`, `Uint8Array.fromBase64`/`toHex` |

### What ◐ covers

Measured, not assumed — three of these rows were wrong on the first pass.

- **`Math`**: `abs acos asin atan atan2 cbrt ceil cos cosh exp expm1 floor
  fround hypot log log10 log1p log2 max min pow round sign sin sinh sqrt tan
  tanh trunc`, and the constants. Absent: `random`, which needs a decision
  about its source rather than an implementation.
- **`Number`**: `isNaN isFinite isInteger isSafeInteger EPSILON`, and
  `toString` on a number. Absent: `toFixed`, `toPrecision`, `parseFloat`,
  `parseInt`.
- **`String.prototype`**: `charAt charCodeAt codePointAt concat endsWith
  includes indexOf lastIndexOf repeat slice startsWith substring length`.
  Absent: `at`, `split`, `replace`, `trim`, `padStart`/`padEnd`, case
  conversion, `match`, and indexing (`s[0]`).
- **`Array.prototype`**: `at fill forEach includes indexOf lastIndexOf map pop
  push reduce reverse slice length`. Absent: `concat`, `filter`, `find`,
  `join`, `sort`, `shift`, `unshift`, `splice`, `some`, `every`, `flat`.
- **Typed arrays**: the constructor from a length, indexing, `length`,
  subclassing. Absent: construction from a value, `fill set subarray slice
  indexOf`, `buffer byteLength byteOffset` — 49 refusals in the node profile,
  reachable only since `extends Uint8Array` began lowering.

## 9. Abstract operations

The conversions and comparisons every operator rests on. They are implemented
where they are reachable rather than as a library, so this is a list of what
the lowering can currently produce — and the gaps here are why some operators
above are refused.

| | |
|---|---|
| ✅ | `ToBoolean` — including the tag switch for an erased value |
| ✅ | `ToString` on a number (`nts_number_to_string`) |
| ✅ | `ToInt32`, `ToUint32` — the bitwise operators |
| ✅ | `ToIntegerOrInfinity`, `ToLength`, `ToIndex` — array bounds |
| ✅ | `ToUint8`/`ToInt8`/`ToUint16`… — storing into a typed array |
| ✅ | strict equality, relational comparison on numbers and strings |
| ◐ | `ToNumber` — from a numeric string is refused (`Number("1")`) |
| ✗ | `ToPrimitive`, `OrdinaryToPrimitive` — `valueOf`/`toString` dispatch |
| ✗ | `SameValue`, `SameValueZero` — wanted by `Object.is`, `Map`, `Set`, `includes` |
| ✗ | loose equality (`==`) — legal in strict code and still specified |
| ✗ | `ToBigInt`, `ToBigInt64`, `ToBigUint64` |
| ∅ | `ToObject`, `ToPropertyKey` — need boxing and a property map |

## 10. The iteration protocol

What `for...of`, spread, destructuring and the combinators are all specified in
terms of. Today each of those is lowered *directly* for the shapes it supports
— `for...of` over an array is a counted loop — so the protocol itself does not
exist yet, and that is why the shapes that are not arrays are refused.

| | |
|---|---|
| ✅ | `for...of` over an array, array destructuring — lowered as counted loops |
| ✗ | `[Symbol.iterator]()`, `.next()`, `{ value, done }` |
| ✗ | iterator **closing** (`.return()` on abrupt completion) — a correctness detail, not a convenience |
| ✗ | `for...of` over a string, a `Map`, a `Set`, a generator |
| ✗ | spread over an iterable |
| ✗ | `yield`, `yield*`, generator objects |
| ✗ | the async iterator protocol, `for await...of` |
| ✗ | iterator helpers (`map`, `filter`, `take`, …) |

## 11. Evaluation order and completions

The obligations most likely to be silently wrong in a compiler, because
nothing fails loudly when they are.

| | |
|---|---|
| ✅ | left-to-right operand evaluation, callee before arguments |
| ✅ | short-circuit `&&`, `\|\|`, `?:` |
| ✅ | an assignment target evaluated **once** — `xs[next()] += 1` calls `next` once, which is what `place_of` exists for |
| ✅ | normal, `return`, `break`, `continue` and `throw` completions |
| ✅ | module evaluation order, and the temporal dead zone as an error |
| ✗ | abrupt completion through `finally` — no `try` at all |
| ✗ | iterator closing on an abrupt completion |
| ✗ | conversion side effects (`valueOf`, `toString`) in operand position |
| ∅ | getter, setter and `Proxy` side effects in operand position — §13 |

## 12. The runtime

`runtime/c`, about 3,300 lines and 130 entry points, provider-swappable.

| | |
|---|---|
| ✅ | allocation; frame placement for what does not escape |
| ✅ | reference counting, and a cycle collector over one traversal |
| ✅ | strings, arrays, objects, tagged values (`NtsValue`) |
| ✅ | promises, microtasks, the tick queue |
| ✅ | timers: `setTimeout`, `setInterval`, `clearInterval` |
| ✅ | host loop, task posting, thread-ownership assertions |
| ✗ | a hash table — what `Map`, `Set` and `Object`'s enumeration statics all need |
| ✗ | a regular-expression engine |
| ✗ | date and time |
| ✗ | shared memory and an agent model — the threading primitives above are the runtime's own task posting, and `Atomics` needs more than they provide |
| ∅ | a property map, a prototype chain, a metaobject protocol — §13 |

## 13. What this compiler is not

Every row here is refused, and none of them is a backlog item. They are one
decision made once, and it is the decision the whole compiler is built on.

### The metaobject protocol

An object in this compiler is a flat C struct: a header of
`descriptor + refcount + flags + length`, then fields at fixed offsets. The
descriptor carries the size, which offsets hold references, and a method table.
**There is no prototype pointer and no property map.**

So the following are not unimplemented — they are incompatible with that
representation, and implementing them means giving it up:

| | why |
|---|---|
| `Proxy`, `Reflect` | every trap is a property operation dispatched at run time |
| property descriptors | `[[Value]]`/`[[Writable]]`/`[[Enumerable]]`/`[[Configurable]]` per property, on an object with no per-property storage |
| `Object.defineProperty`, `freeze`, `seal`, `preventExtensions` | the same |
| `getPrototypeOf`, `setPrototypeOf`, `__proto__` | there is no chain to read or rewrite |
| exotic object kinds, the intrinsic graph, realms | an engine's object model; a compiled program has one static layout per type |
| `Symbol.species`, `Symbol.hasInstance`, `Symbol.toPrimitive`, `Symbol.unscopables` | hooks that redirect built-in operations at run time |
| `Function.prototype.toString`, observable `.name`/`.length` | a function here is a C function, not an object with properties |
| `Function("source")`, `eval` | a compiler is not in the program |

**TypeScript is what earns the right to omit them.** In a typed program the
dynamic property surface is largely unreachable: `defineProperty`, descriptor
manipulation and prototype mutation are not things typed code does, and where
it does them TypeScript types the result `any` — which is refused, deliberately
and separately.

This is not "a subset of JavaScript". It is the observation that a *typed*
program does not need the machinery an untyped one is compiled against.

### Free by construction

Excluded by the source language rather than by choice — a TypeScript module is
always strict, so none of this can reach the compiler:

`with`, sloppy mode, `arguments`, legacy octal, Annex B, `escape`/`unescape`,
`String.prototype.substr` and the HTML-wrapper methods, `Date.prototype.getYear`,
`RegExp.prototype.compile`, `Object.prototype.__defineGetter__` and friends.

### Deferred rather than rejected

Wanted, and not soon: `Atomics` and `SharedArrayBuffer` need an agent model and
a memory model on top of the threading the runtime already has, and they are the
one part of §13's neighbourhood that a native compiler could do *better* than an
engine rather than not at all.

## 14. Where the numbers come from

`tooling/gate/all.sh` runs all of it. Three measures, and they answer different
questions:

| | what it says | today |
|---|---|---|
| examples | the compiled program agrees with node, case by case | 75 of 75 |
| corpus | arbitrary input produces no invalid IR and no C that will not compile | 47 lower cleanly; `invalid HIR` 0, `uncompilable C` 2 |
| profile | how much of a real standard library lowers | 535 functions |

Only the examples check **correctness**. The corpus checks robustness; the
profile measures reach and runs nothing, so a function counted there is one
that compiles rather than one known to be right — and until recently it counted
functions that could not even be emitted, because the row that would have said
so was collected and never printed.

## 15. What to do next, ordered by evidence

From the node profile's refusals, which is the only list ordered by what real
code actually needs rather than by what looks incomplete.

| | what it unblocks | shape of the work |
|---|---|---|
| `Map`, `Set` | ~150 profile refusals; most of `http` and `stream` | one hash table in the runtime, then the two wrappers |
| typed-array methods | 49, all reachable only since `extends Uint8Array` landed | width-aware helpers; the runtime's array helpers take `const double *` and would misread a byte array, which is why they are refused rather than wrong |
| `try`/`catch` | the largest *language* gap | needs an unwinding decision — the runtime has none |
| `Object` statics, `JSON` | 39 | the same hash table as `Map` |
| a class as a value | `instanceof`, static access through a variable | a class needs a runtime representation of itself |
| rest, spread | scattered and common in ordinary code | each is small and independent |
| generators | node's `readline` among others | the suspension machine exists for `async`; what is missing is the `Generator<T>` object and §10's protocol |
| the iteration protocol | `for...of` over anything but an array, spread, generators, `Map`/`Set` iteration | §10 — one protocol that several of the rows above are each waiting on separately |

Two rows in the corpus are meant to be zero and one is not: `uncompilable C` is
2, both narrow — an `as const` nested object literal whose inner layout is
built by nothing, and a quoted key on a generic function's result. They are
ratcheted in `tooling/gate/all.sh` so they can only go down.

### What is *not* on this list, and why

`Proxy`, `Reflect`, property descriptors, prototype manipulation, realms — §13.
They are refused, they will stay refused, and a checklist that files them beside
`Map` turns one decision into a hundred open items.
