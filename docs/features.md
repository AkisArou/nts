# What compiles, and what does not

A status table for the language, the standard library and the runtime.

**Read the "not done" rows as the work queue.** They are ordered inside each
table roughly by how often real TypeScript needs them, not by how hard they are.

## How this was derived, and how to check it

Not from memory. Three sources, and any of them can be re-run:

- **What the lowering handles**: every `syntax::` kind it matches, and every
  method name in its string, array and `Math` tables.
- **What it refuses**: every message it can emit. `rg -o 'unsupported\(.*, "[^"]+"' compiler/core/src/hir/lower.rs`
  is the complete list, and a construct missing from *both* lists is the
  dangerous case — see "Silent gaps" at the end.
- **What is proven to run**: `examples/` are compiled and their answers compared
  against node (`nts check`), and `benches/awfy` is compared against Are We Fast
  Yet's own JavaScript as well.

The corpus (`cargo run -p nts-suite`) is the independent measure: 184 files from
TypeScript's own test suite, of which **66 lower completely** and 30 are refused
with a diagnostic.

---

## Statements and control flow

| feature | status | note |
| --- | :---: | --- |
| `if` / `else` | done | |
| `while` | done | |
| `for (;;)` | done | |
| `for...of` over an array | done | desugared to an index loop; no iterator protocol |
| `return` | done | |
| `throw` | done | as a *termination* — there is no handler to reach |
| block scoping, `let` / `const` | done | |
| `do...while` | **not done** | the syntax kind is known; nothing lowers it |
| `break` / `continue` | **not done** | needed by almost every non-trivial loop |
| `switch` | **not done** | |
| `try` / `catch` / `finally` | **not done** | see *Exceptions* below — this is the big one |
| labelled statements | **not done** | |
| `for...in` | **not done** | needs key enumeration, so needs a shape at runtime |
| `for await` | **not done** | needs async |

## Expressions and operators

| feature | status | note |
| --- | :---: | --- |
| arithmetic, comparison, bitwise | done | exact JavaScript semantics, including `-0` and `ToInt32` |
| `&&` / `\|\|`, ternary | done | short-circuit preserved |
| `++` / `--`, compound assignment | done | through one `Place`, so `xs[next()] += 1` calls `next` once |
| `typeof`, `!`, unary `+` / `-` | done | |
| string concatenation | done | |
| `as`, `!`, `satisfies` | done | erased |
| array and object literals | done | |
| `x?.y`, `x ?? y` | **not done** | |
| template literals | **not done** | very common in real TypeScript |
| spread and rest | **not done** | in calls, arrays and objects |
| destructuring | **not done** | parameters, declarations and assignment |
| `delete`, `in`, `instanceof` | **not done** | |
| regular expressions | **not done** | |

## Types

| feature | status | note |
| --- | :---: | --- |
| `number`, `boolean`, `string`, `void` | done | `number` is an `f64`, narrowed to integers by analysis |
| literal types and unions of them | done | `0 \| 1 \| 2` is one machine type and a fact |
| arrays | done | elements in a block the array points at, so `push` is possible |
| classes and interfaces | done | base-first layout, so an upcast is free |
| `T \| null` / `T \| undefined` for a reference | done | the null pointer *is* the tag |
| **generic classes** | done | one copy per instantiation, like a C++ template |
| generic functions | **not done** | only classes are monomorphized |
| generic class extending another | **not done** | untested and certainly incomplete |
| `number \| undefined` | **not done** | no spare value in a double; needs a tag or a NaN payload |
| unions of unrelated object types | **not done** | needs a discriminant read at runtime |
| optional properties `x?: T` | **not done** | needs a presence bit, which changes the layout |
| tuples | **not done** | |
| `enum` | **not done** | |
| recursive array types (`type T = T[]`) | **not done** | refused, with the cycle named; no finite `HirType` |
| `any` | **not done** | refused by design for application code |
| `unknown` | **not done** | should *not* be refused; needs erased representation analysis |
| mapped, conditional and indexed-access types | **not done** | |

## Classes and objects

| feature | status | note |
| --- | :---: | --- |
| fields, methods, constructors | done | |
| `extends`, `super`, overriding | done | a slot only where something is actually overridden |
| virtual dispatch | done | one table, and only for classes that need one |
| `static` methods | done | a namespaced function; no receiver, no slot |
| `readonly` fields | partial | refused when a *constructor* assigns them, which TypeScript allows |
| getters and setters | **not done** | `x.y` would be a call; Node's API surface needs these |
| `static` properties | **not done** | |
| `private` / `#private` | **not done** | erasable, but not erased yet |
| object literal methods | **not done** | and *silently*: no HIR, no diagnostic |
| computed property names | **not done** | |

## Functions and closures

| feature | status | note |
| --- | :---: | --- |
| declarations, methods, arrows | done | |
| closures | done | a closure is an object with one method, and gets the object machinery |
| higher-order calls | done | monomorphized — one copy per closure class |
| `declare function` (FFI) | done | lowered as external and declared in the emitted C |
| `forEach` with an inline arrow | done | desugared to a loop, so no allocation and no dispatch |
| capturing a *reassigned* variable | **not done** | refused: this captures by value, JavaScript by reference |
| default and optional parameters | **not done** | |
| overloads | partial | signatures are skipped; the implementation is lowered |
| generators (`function*`, `yield`) | **not done** | |

## Standard library

| feature | status | note |
| --- | :---: | --- |
| `String`: `charCodeAt`, `charAt`, `codePointAt` | done | |
| `String`: `indexOf`, `lastIndexOf`, `includes`, `startsWith`, `endsWith` | done | `memchr`/`memcmp` where both sides are narrow |
| `String`: `slice`, `substring`, `concat`, `repeat`, `length` | done | one-byte and two-byte representations, as V8 has |
| `String`: `toUpperCase`, `toLowerCase`, `trim`, `split`, `replace` | **not done** | the first three are Unicode, not ASCII, and being wrong is worse than absent |
| `Array`: `push`, `pop`, `at`, `fill`, `reverse`, `slice`, `length` | done | |
| `Array`: `indexOf`, `lastIndexOf`, `includes` | done | `includes` uses SameValueZero, so it finds `NaN`; `indexOf` does not |
| `Array`: `map`, `filter`, `reduce`, `sort`, `splice`, `join` | **not done** | |
| assigning `array.length` | **not done** | needed by `som`'s `Vector` |
| `Math`: `abs`, `ceil`, `floor`, `round`, `trunc`, `sqrt`, `min`, `max` | done | `Math.round` is not C's `round`, and this one is JavaScript's |
| `Math`: `pow`, `log`, `exp`, `sin`, `cos`, `random` | **not done** | |
| `Map`, `Set` | **not done** | needed by every real program, and by the AWFY macro benchmarks |
| `JSON`, `Date`, `RegExp` | **not done** | |
| `console.log` | partial | a `throw`'s message is printed; there is no general `console` |

## The runtime

| feature | status | note |
| --- | :---: | --- |
| NoGC bump allocation | done | RFC §9.1 |
| reference counting | done | RFC §9.2, with Bacon–Rajan cycle collection |
| escape analysis | done | an object that does not outlive its frame stays in it |
| frame-allocated strings | done | a slice that does not escape costs no allocation |
| a nursery / generational GC | **not done** | RFC §9.3; this is what closes the last gap to V8 on allocation-heavy code |
| **exceptions** | **not done** | `throw` terminates; there is no unwinding and no handler |
| **promises and `async` / `await`** | **not done** | see below |
| event loop | **not done** | |
| modules across compilation units | partial | one program at a time; imports within it work |
| a native library ABI | **not done** | RFC §27.1 — everything emitted is `static` today |
| threads, `SharedArrayBuffer`, atomics | **not done** | |

### Why promises and `async`/`await` are one large item, not a feature

Until today `async` was *accepted and wrong*: `Promise<number>` had no
representation, so the return type resolved to `void` and the returned value was
converted away. It is refused now, which is honest, and the real thing needs four
things that do not exist:

1. **A representation for `Promise<T>`** — an object holding a state, a value or
   an error, and a list of continuations.
2. **A transformation of the function** into something resumable: a state
   machine, or CPS. This is the part that is a *compiler* feature rather than a
   library one, and it is the reason `await` cannot be a runtime call.
3. **Frames that outlive their caller.** A suspended function's locals cannot be
   on the stack, so the transformation has to decide what is captured and hand
   it to the memory provider — which is the same escape question this compiler
   already answers for closures, asked at a harder moment.
4. **An event loop**, and something for it to wait on. A microtask queue alone
   is enough for `Promise.resolve().then(...)` and useless for anything real;
   what makes it worth having is I/O, which is what the parallel Node work is
   building on libuv.

Ordered against everything else, it is *large and late*: it is worth doing after
exceptions, because a rejected promise is an exception that crossed a suspension,
and building the second without the first means building it twice.

---

## Silent gaps: the ones that are neither done nor refused

The most important row in any of these tables is the one that is missing from
both lists. A construct that fails *quietly* never enters the refusal histogram,
so it never enters the work queue either — the queue is biased toward whatever
fails loudly.

Two are known, both found by writing ordinary TypeScript rather than by aiming
at them:

| gap | what happened |
| --- | --- |
| `async` (fixed) | returned `void`, discarded the value, and the verifier accepted it |
| an object-literal method | produces no HIR and no diagnostic — `export const bag = { f() {...} }` reports "0 functions, nothing refused" |

The second is still open. Both come from the same place: `collect_module_scope`
looks for a module-scope name by finding an `IDENTIFIER` child, and a binding
pattern has none, so the symbol is neither registered nor refused.

## What to do next

In order, with the reason rather than the ranking:

1. **Finish generics** — generic *functions*, and a generic class that extends
   another. Both are needed by `som`'s collections, which are the gate on the
   five Are We Fast Yet macro benchmarks, which are the only real programs in
   reach. Everything below is easier to judge once there is a program bigger
   than thirty lines to judge it against.
2. **`break`, `continue`, `switch`, `do...while`** — small, and between them
   they are in almost every loop anybody writes.
3. **`Map` and `Set`** — no real program does without them.
4. **Exceptions** — `try`/`catch` with real unwinding. Large, and a prerequisite
   for promises rather than an alternative to them.
5. **Template literals and destructuring** — the two most common things in
   modern TypeScript that this compiler cannot read at all.
6. **Tagged unions** — `number | undefined` and unions of unrelated objects.
   RFC-level: it changes the representation of every value that can reach the
   slot.
7. **Promises and `async`/`await`**, on top of 4.

Two small ones worth taking whenever they are convenient, because both are
already-known defects rather than absent features: `readonly` assigned in a
constructor, and getters.
