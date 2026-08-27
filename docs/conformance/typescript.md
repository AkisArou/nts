# TypeScript language and runtime conformance

What compiles, what is refused, and what is neither.

Companion to [`nodejs.md`](nodejs.md), which tracks the Node API surface. This
file is the *language* and the *runtime under it*.

## How this was derived, and how to check it

Not from memory — from the compiler and from probes. Four sources, all
re-runnable:

- **What the lowering handles**: every `syntax::` kind it matches, and every name
  in its string, array and `Math` tables.
- **What it refuses**: `rg -o 'unsupported\(.*, "[^"]+"' compiler/core/src/hir/lower.rs`
  is the complete list of messages it can emit.
- **Probes.** One exported function per feature, compiled with `nts emit-c`. The
  lowering reports one diagnostic per function, so a file of thirty functions
  answers thirty questions at once. This is how the "neither" rows below were
  found, and it is worth repeating whenever the table is doubted.
- **`nts check`**, which runs a compiled program and node's answer side by side.

The corpus (`cargo run -p nts-suite`) is the independent measure: 184 files from
TypeScript's own test suite, **66 lowering completely** and 30 refused with a
diagnostic.

---

## Primitives and globals

| feature | status | note |
| --- | :---: | --- |
| `number` | done | an `f64`, narrowed to integers by analysis where provable |
| `boolean` | done | |
| `string` | done | UTF-16 code units, one-byte and two-byte forms as V8 has |
| `NaN`, `Infinity`, `-Infinity` | done | and `-0` is distinguished from `0` wherever the sign is observable |
| `null`, `undefined` | done | one value; for a reference the null pointer *is* the tag |
| `void` type | done | |
| **`symbol` / `Symbol()`** | **not done** | no representation; `Symbol.iterator` is also why `for...of` is a desugaring rather than a protocol |
| `bigint` / `1n` | **not done** | |
| `object` (the type) | **not done** | |
| `globalThis` | **not done** | |
| `isNaN`, `isFinite`, `parseInt`, `parseFloat` | **broken** | see *Known defects* — they lower to link-time externs rather than being refused |
| `Number.MAX_SAFE_INTEGER`, `Number.isInteger`, … | **not done** | |
| `.toString()`, `String(x)`, `Number(x)` | **not done** | no conversions between primitives |

## Statements and control flow

| feature | status | note |
| --- | :---: | --- |
| `if` / `else` | done | |
| `while` | done | |
| `for (;;)` | done | |
| `for...of` over an array | done | desugared to an index loop; no iterator protocol |
| `return` | done | |
| `throw` | done | as a *termination* — there is no handler to reach |
| `let` / `const`, block scoping | done | |
| `do...while` | **not done** | |
| `break` / `continue` | **not done** | in almost every non-trivial loop |
| `switch` | **not done** | |
| labelled statements | **not done** | |
| `try` / `catch` / `finally` | **not done** | see *The runtime* |
| `for...in` | **not done** | needs key enumeration, so needs a shape at run time |
| `for await` | **not done** | needs async |

## Expressions and operators

| feature | status | note |
| --- | :---: | --- |
| arithmetic, comparison, bitwise | done | exact JavaScript semantics, including `ToInt32` and `-0` |
| `>>>` | done | the one bitwise result that is `uint32` rather than `int32` |
| `&&` / `\|\|`, ternary | done | short-circuit preserved |
| `++` / `--`, compound assignment | done | through one `Place`, so `xs[next()] += 1` calls `next` once |
| `+=` on strings | done | concatenation, not addition — the two lower to nothing alike |
| `typeof`, `!`, unary `+` / `-` | done | |
| numeric separators (`1_000`) | done | |
| array and object literals | done | |
| `as`, `!`, `satisfies` | done | erased |
| immediately-invoked arrows | done | |
| `**` | **not done** | |
| the `void` operator | **not done** | |
| the comma operator | **not done** | |
| `s[0]` on a string | **not done** | indexing is an array operation here |
| `?.` and `??` | **not done** | |
| template literals | **not done** | very common in real TypeScript |
| spread and rest in calls or literals | **not done** | |
| destructuring | **not done** | declarations, parameters and assignment |
| `delete`, `in`, `instanceof` | **not done** | |
| regular expression literals | **not done** | |

## Types

| feature | status | note |
| --- | :---: | --- |
| primitives, literal types, unions of literals | done | `0 \| 1 \| 2` is one machine type and a useful fact |
| arrays | done | elements in a block the array points at, so `push` is possible |
| classes and interfaces | done | base-first layout, so an upcast is a no-op |
| `T \| null`, `T \| undefined` for a reference | done | the null pointer is the tag |
| **generic classes** | done | one copy per instantiation, like a C++ template |
| type aliases | done | erased |
| **generic functions** | **not done** | only classes are monomorphized |
| a generic class extending another | **not done** | untested and certainly incomplete |
| `number \| undefined` | **not done** | no spare value in a double; needs a tag or a NaN payload |
| unions of unrelated object types | **not done** | needs a discriminant read at run time |
| optional properties (`x?: T`) | **not done** | needs a presence bit, which changes the layout |
| index signatures (`[k: string]: T`) | **not done** | keys are not known at compile time, so not a flat struct |
| tuples | **not done** | |
| `enum` / `const enum` | **not done** | |
| recursive array types (`type T = T[]`) | **not done** | refused with the cycle named; no finite `HirType` |
| `keyof`, `typeof` type operator | **not done** | |
| mapped, conditional, indexed-access, template-literal types | **not done** | |
| `any` | **not done** | refused by design for application code |
| `unknown` | **not done** | should *not* be refused — needs erased-representation analysis |

## Classes and objects

| feature | status | note |
| --- | :---: | --- |
| fields, methods, constructors | done | |
| `extends`, `super`, overriding | done | a dispatch slot only where something is actually overridden |
| virtual dispatch | done | one table, and only for classes that need one |
| `static` methods | done | a namespaced function: no receiver, no slot |
| `implements` | done | erased |
| `readonly` fields | partial | refused when a *constructor* assigns them, which TypeScript allows |
| getters and setters | **not done** | `x.y` would be a call; Node's API surface needs these |
| `static` properties | **not done** | |
| parameter properties (`constructor(public x: number)`) | **not done** | |
| `abstract` classes and methods | **not done** | |
| class expressions | **not done** | |
| `private` / `#private` | **not done** | erasable, not erased yet |
| object-literal methods | **broken** | see *Known defects* — silently produces nothing |
| computed property names | **not done** | |
| decorators | **not done** | |

## Functions and closures

| feature | status | note |
| --- | :---: | --- |
| declarations, methods, arrows | done | |
| closures | done | a closure is an object with one method, so it gets the object machinery |
| higher-order calls | done | monomorphized — one copy per closure class |
| `forEach` with an inline arrow | done | desugared to a loop: no allocation, no dispatch |
| `declare function` (FFI) | done | lowered as external and declared in the emitted C |
| overload signatures | done | skipped; the implementation is lowered |
| nested function declarations | **not done** | |
| default parameters | **not done** | needs the initializer evaluated at every call that omits it |
| rest parameters | **not done** | needs an array built at the call |
| generators (`function*`, `yield`) | **not done** | |
| `new.target`, `arguments` | **not done** | |

## Standard library

| feature | status | note |
| --- | :---: | --- |
| `String`: `charCodeAt`, `charAt`, `codePointAt` | done | |
| `String`: `indexOf`, `lastIndexOf`, `includes`, `startsWith`, `endsWith` | done | `memchr`/`memcmp` when both sides are narrow |
| `String`: `slice`, `substring`, `concat`, `repeat`, `length` | done | a slice that does not escape is built in the frame |
| `String`: `split`, `replace`, `trim`, `toUpperCase`, `toLowerCase`, `padStart` | **not done** | the case operations are Unicode, not ASCII, and being wrong is worse than being absent |
| `Array`: `push`, `pop`, `at`, `fill`, `reverse`, `slice`, `length` | done | |
| `Array`: `indexOf`, `lastIndexOf`, `includes` | done | `includes` uses SameValueZero and finds `NaN`; `indexOf` does not |
| `Array`: `map`, `filter`, `reduce`, `sort`, `splice`, `join`, `find`, `some`, `every` | **not done** | |
| assigning `array.length` | **not done** | needed by `som`'s `Vector` |
| `Math`: `abs`, `ceil`, `floor`, `round`, `trunc`, `sqrt`, `min`, `max` | done | `Math.round` is not C's `round`, and this one is JavaScript's |
| `Math`: `pow`, `log`, `exp`, `sin`, `cos`, `atan2`, `random`, `hypot` | **not done** | |
| `Object`: `keys`, `values`, `entries`, `assign`, `freeze` | **not done** | |
| `Map`, `Set`, `WeakMap`, `WeakSet` | **not done** | every real program needs the first two |
| `Error` and its subclasses | **not done** | `throw new Error(m)` is recognised as a *shape*, not as a class |
| `JSON`, `Date`, `RegExp` | **not done** | |
| typed arrays, `ArrayBuffer`, `DataView` | **not done** | |
| `Promise` | **not done** | see below |
| `Reflect`, `Proxy`, `Intl`, `WeakRef` | **not done** | |
| `console.log` | partial | a `throw`'s message is printed; there is no general `console` |

## The runtime

| feature | status | note |
| --- | :---: | --- |
| NoGC bump allocation | done | RFC §9.1 |
| reference counting | done | RFC §9.2, with Bacon–Rajan cycle collection |
| escape analysis | done | an object that does not outlive its frame stays in it |
| frame-allocated strings | done | a slice that does not escape costs no allocation |
| modules within one program | done | |
| FFI to C | done | `declare function` plus an emitted prototype |
| a nursery / generational GC | **not done** | RFC §9.3 — what closes the last gap to V8 on allocation-heavy code |
| **exceptions** | **not done** | `throw` terminates; no unwinding, no handler |
| **promises and `async` / `await`** | **not done** | see below |
| an event loop | **not done** | |
| a native library ABI | **not done** | RFC §27.1 — everything emitted is `static` |
| separate compilation | **not done** | one program at a time |
| threads, atomics, `SharedArrayBuffer` | **not done** | |

### Why promises and `async`/`await` are one large item

Until today `async` was *accepted and wrong*: `Promise<number>` had no
representation, so the return type resolved to `void` and the returned value was
converted away. It is refused now, which is honest. The real thing needs four
things that do not exist:

1. **A representation for `Promise<T>`** — an object holding a state, a value or
   an error, and a list of continuations.
2. **A transformation of the function** into something resumable: a state machine
   or CPS. This is the part that is a *compiler* feature rather than a library
   one, and it is why `await` cannot be a runtime call.
3. **Frames that outlive their caller.** A suspended function's locals cannot be
   on the stack, so the transformation decides what is captured and hands it to
   the memory provider — the same escape question this compiler already answers
   for closures, asked at a harder moment.
4. **An event loop, and something for it to wait on.** A microtask queue alone
   runs `Promise.resolve().then(...)` and nothing anyone wants; what makes it
   worth having is I/O.

It belongs *after* exceptions: a rejected promise is an exception that crossed a
suspension, so building promises first means building unwinding twice.

---

## Known defects

Distinct from "not done". These either produce a wrong answer or produce C that
does not compile, and in every case **the compiler reports success**. A construct
that fails quietly never enters the refusal histogram, so it never enters the
work queue either — which is how each of these survived.

| defect | what happens | found by |
| --- | --- | --- |
| `isNaN`, `parseInt`, and other `lib.d.ts` builtins | lowered as *FFI imports*, so a prototype is emitted and the program fails at link time instead of being refused. A regression from making `declare function` external — an ambient declaration in the user's own source is an import, but one in `lib.d.ts` is a builtin this compiler has not implemented, and the two are not distinguished yet. | this cross-check |
| an object-literal method | `export const bag = { f() {…} }` produces no HIR and no diagnostic — "0 functions, nothing refused". `collect_module_scope` finds a module-scope name by looking for an `IDENTIFIER` child, and a binding pattern has none, so the symbol is neither registered nor refused. | the Node session |
| a `namespace` | the declaration is silently skipped; only a *use* of it is refused. Same cause as the row above. | this cross-check |
| `readonly` assigned in a constructor | refused, though TypeScript permits it | the Node session |

Three more were found the same way and are **fixed**: bare `async` returning
`void` and discarding the value; `s += t` on strings lowering to pointer
arithmetic; and default and rest parameters lowering as ordinary ones, which
emitted a call with the wrong number of arguments.

## What to do next

In order, with the reason rather than the ranking:

1. **Finish generics** — generic *functions*, and a generic class extending
   another. Both gate `som`'s collections, which gate the five Are We Fast Yet
   macro benchmarks, which are the only real programs in reach. Everything below
   is easier to judge against a program bigger than thirty lines.
2. **`break`, `continue`, `switch`, `do...while`** — small, and between them in
   almost every loop anyone writes.
3. **The four known defects above** — each is a case where this compiler says
   yes and means no, which is worse than any absent feature.
4. **`Map` and `Set`** — no real program does without them.
5. **Template literals and destructuring** — the two most common things in modern
   TypeScript that this compiler cannot read at all.
6. **Exceptions** — `try`/`catch` with real unwinding. Large, and a prerequisite
   for promises rather than an alternative to them.
7. **Tagged unions** — `number | undefined` and unions of unrelated objects.
   RFC-level: it changes the representation of every value that can reach the
   slot.
8. **Promises and `async`/`await`**, on top of 6.

Getters and `readonly`-in-a-constructor are small and can be taken whenever
convenient; both are known defects rather than absent features.
