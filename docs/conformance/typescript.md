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
TypeScript's own tests), the examples (84 programs run against node case by
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
| ✅ | a **named function used as a value** — one static instance, so identity holds |
| ✅ | recursion |
| ✅ | `async`/`await` |
| ✅ | type predicates (`x is T`) and `asserts x is T` |
| ✅ | rest parameters | the call gathers its trailing arguments into the array |
| ✗ | `function` expressions — an arrow with the same body lowers |
| ✗ | closures over a variable something **assigns to** — this captures by value and JavaScript by reference |
| ✗ | generators (`function*`, `yield`) — needs the `Generator<T>` object |

### A function as a value costs one static object, and nothing where it is not used

`nextTick(finish, stream)` needs `finish` as a value. The answer is a closure
with no captures whose `call` forwards to `finish`, emitted once:

```c
static NtsObj_Closure0 nts_fnval_NtsObj_Closure0 = {{&nts_desc_NtsObj_Closure0, NTS_IMMORTAL, 0, 0}};
...
    v1 = &nts_fnval_NtsObj_Closure0;      /* no allocation */
    v3 = inc(v0);                          /* an ordinary call is still an ordinary call */
```

One instance rather than one per mention, because `finish === finish` has to be
true and an event emitter removes a listener by exactly that comparison. It
forwards rather than re-lowering the declaration's body, so a recursive function
used as a value still has one definition and recurses into it.

Deliberately **not** extended to a non-capturing arrow: `(() => 1) === (() =>
1)` is false in JavaScript — two evaluations make two objects — so folding those
to one instance would answer a comparison wrongly. `examples/function-values`
holds both halves.

The wrapper exists only for functions something actually passes. A program of
ordinary calls emits no closure struct, no dispatch slot and no table at all.

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

### A class has no runtime identity, and it is the layout's fault

`instanceof` and `.constructor` are the two places JavaScript stays *nominal* at
runtime, and neither can be built on what is emitted today. Two classes of the
same shape share one layout — deliberately, because TypeScript is structurally
typed and the two are mutually assignable, so sharing the struct is what makes
passing one where the other is expected cost nothing. But they share the
*descriptor* with it:

```c
struct NtsObj_Alpha { ... };
void Beta__constructor(NtsObj_Alpha * v0, double v1);
static const NtsDescriptor nts_desc_NtsObj_Alpha = { ..., "Alpha", ... };
v3_frame.header.descriptor = &nts_desc_NtsObj_Alpha;   /* this is a Beta */
```

A `Beta` carries Alpha's descriptor and answers `"Alpha"` when asked its name.
Nothing observable depends on that yet, because neither `instanceof` nor
`.constructor` is implemented — but it is why neither *can* be, and it is the
first thing to fix if they are wanted. The shape is structural and belongs to
the layout; the identity is nominal and needs a table of its own, one entry per
class, carrying the name and the base. The descriptor would then follow the
class rather than the layout.

Worth knowing before starting: of the 67 refusal sites that named a class used
as a value, **none** would be closed by this. Fifty-nine are one idiom in the
node profile —

```ts
override get ["constructor"](): unknown { return TypeError; }
```

— and the remaining eight are `instanceof` against `Error`, `RangeError` or
`Uint8Array`. Every right-hand side in all 67 is an ambient `lib` class this
compiler does not declare, so the nominal machinery is necessary for them and
nowhere near sufficient.

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
| ✅ | arrays; a tuple whose elements agree *is* an array of them |
| ✅ | heterogeneous tuples — a struct with positional fields, `_0` and `_1` |
| ✅ | objects — a flat struct with a layout |
| ✅ | typed arrays: all eight kinds, as `NtsArray` with a narrow element |
| ✅ | `unknown`, `any` sites, unions, optional properties — one 16-byte tagged value |
| ✅ | `null` and `undefined`, as two values — see below for what a pointer can hold |
| ✅ | `Map`, `Set` — one insertion-ordered table, keys and values as tagged values |
| ✅ | the polymorphic `this` — the receiver's own pointer, which costs nothing |
| ◐ | `bigint` — exact, and **128 bits** rather than arbitrary precision |
| ✗ | `symbol` |

### `null` is not `undefined`, and a pointer holds one of them

A reference has exactly one spare bit pattern, so `T | null` and `T | undefined`
each cost nothing — the null pointer *is* the tag, and the common case pays
nothing for the distinction.

`T | null | undefined` has two absences and a pointer has room for one. It was
given the pointer representation anyway, and the compiler answered

```ts
const v: string | null | undefined = …;
(v === null ? 1 : 0) + (v === undefined ? 10 : 0)   // 11, which JavaScript cannot produce
```

Two absences now select the erased representation, where each has a tag of its
own — `NTS_TAG_NULL` beside `NTS_TAG_UNDEFINED`. The two tags are adjacent to
`NTS_TAG_OBJECT` on purpose, because `typeof null` is `"object"`: it keeps
`typeof x === "object"` a single comparison rather than a pair.

Measured before and after across the node profile: 1,155 refusal sites either
way, three moving in each direction. The correctness cost nothing in reach.

Two gaps this opened, both small and both real:

- `v?.length` directly on a two-absence union is refused — the receiver is
  erased and the present branch does not unerase it. Narrowing first works, in
  all three forms: `v !== null && v !== undefined`, `typeof v === "string"`, and
  plain truthiness.
- a bare `null` *literal* as an argument whose parameter is a two-absence union
  (`m.set(null, 1)`) finds no contextual type. The same call through a variable
  is fine.

`bigint`'s width is the one place this table promises less than the language.
The boundary is deliberate and visible: a literal too large is refused where it
is written. Every `bigint` in the node profile is a 64-bit quantity —
`readBigUInt64BE`, an hrtime timestamp, `0xffffffffffffffffn` — and a true
bignum would put a heap allocation into each of them. What replaces it, when
something needs `2n ** 200n`, is a small-integer fast path beside a heap bignum.

It is also its own `HirType` rather than a wide integer, and that is not
bookkeeping: `1n << 40n` is 2^40 where `1 << 40` is 256, because a *number*'s
shift masks its count to five bits. Sharing the integer type let constant
folding answer the number's question, silently and correctly by its own lights.

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

- **Done, and without a hash table.** `keys` and `hasOwn` are answered by the
  *layout*: the field names in declaration order, which is what a base-first
  layout is, and a constant `true`/`false` for a key the compiler can see.
  `Array.isArray` is the same idea one type over — and the reason it is not a
  one-liner is that it must ask the **checker's** type, not the
  representation: a `Uint8Array` is an `NtsArray` here and
  `Array.isArray(new Uint8Array(4))` is `false` in node.
- **Still a gap.** `entries values assign fromEntries is groupBy`. `entries`
  wants the tuple representation (which now exists) plus an array of them;
  `is` wants `SameValue`, which is `===` with the `NaN` and `±0` rules
  inverted.
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
terms of. The protocol object still does not exist — and most of what was
waiting on it no longer is, because a `for...of` over a *known* shape never
needed one.

One walk serves all three shapes: a cursor and three questions — where it
starts, whether it is still going, what it reads. That is what let `break`,
`continue` and the loop-carried names be solved once instead of three times.

| | |
|---|---|
| ✅ | `for...of` over an array — a counted loop, unchanged |
| ✅ | over a `Set`, and over `map.keys()` / `map.values()` — the table read directly, no iterator allocated |
| ✅ | over a `Map` and `map.entries()`, bound as `[key, value]` — two names, two reads, no pair built |
| ✅ | over a string, **by code point**: `"a\u{1F600}b"` yields three items, not four |
| ✅ | array and object destructuring, including nested and renamed |
| ✅ | mutation during a walk: an entry appended is visited, one deleted ahead is not |
| ✗ | `[Symbol.iterator]()`, `.next()`, `{ value, done }` — the object itself |
| ✗ | iterator **closing** (`.return()` on abrupt completion) — a correctness detail, not a convenience |
| ✗ | `for...of` over a generator, or over a user type with `[Symbol.iterator]` |
| ✗ | spread over an iterable; `new Map([[k, v]])`, `Array.from` |
| ✗ | `Map`/`Set` `forEach` |
| ✗ | a default in a destructuring pattern (`{ a = 1 }`) |
| ✗ | `yield`, `yield*`, generator objects |
| ✗ | the async iterator protocol, `for await...of` |
| ✗ | iterator helpers (`map`, `filter`, `take`, …) |

The mutation row is the one worth keeping honest about. A walk's whole state is
an entry index, so a rehash that compacted the table's holes would move entries
out from under it. Growth therefore keeps every entry where it is, which costs a
hole not being reclaimed until `clear` — the fix, when that matters, is the list
of live iterators V8 keeps.

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
| examples | the compiled program agrees with node, case by case | 84 of 84 |
| corpus | arbitrary input produces no invalid IR and no C that will not compile | 48 lower cleanly; `invalid HIR` 0, `uncompilable C` 2 |
| profile | how much of a real standard library lowers | 664 functions, all of which verify |

Only the examples check **correctness**. The corpus checks robustness; the
profile measures reach and runs nothing, so a function counted there is one
that compiles rather than one known to be right — and until recently it counted
functions that could not even be emitted, because the row that would have said
so was collected and never printed.

Two ways the profile number has since been caught lying, both worth remembering
before quoting it:

- It once counted functions the verifier had never seen. `nts hir` verifies the
  **pruned** program, and an addon emits every *export* — so an exported
  function nothing calls was dropped before the check and compiled anyway. That
  is how `void FSWatcher__ref(...)` came to return a pointer.
- It went **down** by 26 once, and that was the fix: a return type with no
  representation used to default to `void`, so those functions were being
  counted as lowered while emitting C that does not compile.

`uncompilable C` has the same shape of problem and still does. It is ratcheted
at 2, and 2 is not the true count: the emitter *silently drops* a struct field
whose C type it cannot compute, while the descriptor beside it keeps taking an
`offsetof` into it. Making that a diagnostic reads **5**, all saying `an object
type with no layout`. The honest repair — every object-typed field must have a
layout — costs 40 profile functions, which is why it is written down here
rather than done quietly under a feature.

## 15. What to do next, ordered by evidence

From the node profile's refusal sites — 1,050 of them, counted **once each**.
The raw sweep reports about five times that, because a module is re-compiled
once per importer and `util/types.ts` is counted twenty-one times over. This is
the only list ordered by what real code actually needs rather than by what looks
incomplete.

Read the counts as *upper bounds on what is visible*, not as effort. Twice this
week a tall row was one thing repeated, and twice it was several unrelated
things sharing a message — so the first move on any row below is to name what it
blocks on, not to start building.

| | what it unblocks | shape of the work |
|---|---|---|
| closures and function values | was 101 across four rows; **a named function used as a value is done** and took the profile from 1,155 sites to 1,050. What is left is capture *by reference* (20) and a name from an enclosing scope (27) | capture more than one scope up already works, and so does a returned closure — the row said otherwise and was not checked |
| module evaluation | 81 — one refusal repeated across the top level of nearly every module | a statement at module scope that is not a declaration; the evaluation order is already modelled |
| a member a type does not declare | 80 — 26 of them on an anonymous type, then `StreamLike` (12) | mostly structural types the decomposition stopped at; count before building |
| a global member | 78 — a long tail: `Object.defineProperty` 14, `Array.from` 10, `ArrayBuffer.isView` 7 | the largest entry is §13's, so this row is smaller than it looks |
| `instanceof` | 67, but **8** are `instanceof` — 59 are one idiom, `override get ["constructor"]() { return TypeError; }` | blocked twice over: two classes of a shape share a descriptor (§4), and every right-hand side in all 67 is an ambient `lib` class this compiler does not declare |
| the async iterator protocol | 62, all `AsyncIterableIterator` | §10 plus the suspension machine, which `async` already has |
| `symbol` | 52 — mostly `string \| symbol` as a property key | a representation, and a decision about whether well-known symbols are values or names |
| `typeof` on an open value | 45 | the tag exists; what is missing is the tag *not distinguishing an array from an object* |
| a method not in the hierarchy | 40 — `emit` 8, then a long tail of 23 | structural dispatch, which is the same question as the anonymous-type row above |
| string methods | 15 — `toLowerCase` 12, `normalize` 2, `toUpperCase` 1. `split`, `trim`, `replace` and `replaceAll` are done | what is left wants a Unicode case table and normalization, which is a different order of work from the rest |
| generators | 4 refusals, but `readline` and several streams are behind them | the suspension machine exists; what is missing is the `Generator<T>` object and §10's protocol |
| `try`/`catch` | the largest *language* gap, and invisible in this table because the code that needs it does not reach the lowering | needs an unwinding decision — the runtime has none |

Two rows in the corpus are meant to be zero. `invalid HIR` is 0. `uncompilable
C` is ratcheted at 2 and only downward — see §14 for why 2 is not the true
number and what the honest count costs.

### What came off this list

Kept because the reasons are more useful than the checkmarks. `Map` and `Set`
(~150) were one hash table. Typed-array methods (56) turned out to be 34 calls
to Buffer's *own* methods on its own `this`, and four lines fixed them. Tuples
(40) and `bigint` (47) were both hiding inside a single row that said `Map`
until the refusal named its type arguments. The iteration protocol was mostly
not needed: a `for...of` over a known shape never wanted an iterator object.

### What is *not* on this list, and why

`Proxy`, `Reflect`, property descriptors, prototype manipulation, realms — §13.
They are refused, they will stay refused, and a checklist that files them beside
`Map` turns one decision into a hundred open items.
