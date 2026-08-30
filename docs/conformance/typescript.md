# TypeScript language and runtime conformance

What compiles, what is refused, and what is missing entirely.

Companion to [`nodejs.md`](nodejs.md), which tracks the Node API surface, and to
[`test262.md`](test262.md), which tracks the numeric slice of the ECMAScript
suite. This file is the *language* and the *runtime under it*.

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
| ✗ | refused with a diagnostic |

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
| ✗ | `??`, `??=`, `\|\|=`, `&&=` | |
| ✗ | `?.`, `?.()` | optional chaining |
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

The complete global object, host additions excluded.

| group | ✅ | ✗ |
|---|---|---|
| value properties | `Infinity`, `NaN`, `undefined` | `globalThis` |
| function properties | `isNaN`, `isFinite` | `parseInt`, `parseFloat`, `eval`, `encodeURI(Component)`, `decodeURI(Component)` |
| fundamental | `String` (as a function), `Number` | `Object`, `Function`, `Boolean`, `Symbol` |
| errors | `Error`, `TypeError`, `RangeError`, `URIError` | `ReferenceError`, `SyntaxError`, `EvalError`, `AggregateError`, `SuppressedError` |
| numbers, dates | `Math` ◐, `Number` ◐ | `BigInt`, `Date` |
| text | `String.prototype` ◐ | `RegExp` |
| indexed | `Array` ◐, eight typed arrays ◐ | `Array` statics, `Uint8ClampedArray`, `Float16Array`, `BigInt64Array`, `BigUint64Array` |
| keyed | — | `Map`, `Set`, `WeakMap`, `WeakSet` |
| structured | — | `ArrayBuffer`, `SharedArrayBuffer`, `DataView`, `Atomics`, `JSON` |
| memory | — | `WeakRef`, `FinalizationRegistry` |
| control | `Promise` | `Iterator`, `Proxy`, generator objects |
| reflection | — | `Reflect` |
| internationalization | — | `Intl` |

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

## 9. The runtime

`runtime/c`, about 3,300 lines and 130 entry points, provider-swappable.

| | |
|---|---|
| ✅ | allocation; frame placement for what does not escape |
| ✅ | reference counting, and a cycle collector over one traversal |
| ✅ | strings, arrays, objects, tagged values (`NtsValue`) |
| ✅ | promises, microtasks, the tick queue |
| ✅ | timers: `setTimeout`, `setInterval`, `clearInterval` |
| ✅ | host loop, task posting, thread-ownership assertions |
| ✗ | a hash table — what `Map`, `Set` and `Object` statics all need |
| ✗ | a regular-expression engine |
| ✗ | date and time |
| ✗ | `Atomics`/`SharedArrayBuffer` — the threading primitives above are the runtime's own task posting, not shared memory |

## 10. Where the numbers come from

`tooling/gate/all.sh` runs all of it. Three measures, and they answer different
questions:

| | what it says | today |
|---|---|---|
| examples | the compiled program agrees with node, case by case | 73 of 73 |
| corpus | arbitrary input produces no invalid IR and no C that will not compile | 47 lower cleanly; `invalid HIR` 0, `uncompilable C` 2 |
| profile | how much of a real standard library lowers | 535 functions |

Only the examples check **correctness**. The corpus checks robustness; the
profile measures reach and runs nothing, so a function counted there is one
that compiles rather than one known to be right — and until recently it counted
functions that could not even be emitted, because the row that would have said
so was collected and never printed.

## 11. What to do next, ordered by evidence

From the node profile's refusals, which is the only list ordered by what real
code actually needs rather than by what looks incomplete.

| | what it unblocks | shape of the work |
|---|---|---|
| `Map`, `Set` | ~150 profile refusals; most of `http` and `stream` | one hash table in the runtime, then the two wrappers |
| typed-array methods | 49, all reachable only since `extends Uint8Array` landed | width-aware helpers; the runtime's array helpers take `const double *` and would misread a byte array, which is why they are refused rather than wrong |
| `try`/`catch` | the largest *language* gap | needs an unwinding decision — the runtime has none |
| `Object` statics, `JSON` | 39 | the same hash table as `Map` |
| a class as a value | `instanceof`, static access through a variable | a class needs a runtime representation of itself |
| rest, spread, `??`, `?.` | scattered, common in ordinary code | each is small and independent |
| generators | node's `readline` among others | the suspension machine exists for `async`; what is missing is the `Generator<T>` object |

Two rows in the corpus are meant to be zero and one is not: `uncompilable C` is
2, both narrow — an `as const` nested object literal whose inner layout is
built by nothing, and a quoted key on a generic function's result. They are
ratcheted in `tooling/gate/all.sh` so they can only go down.
