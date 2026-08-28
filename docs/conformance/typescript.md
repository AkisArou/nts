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
| `n.toString()`, `String(n)`, `s + n` | done for a **number** | ECMAScript's `Number::toString`, not a `printf` conversion: the shortest decimal that reads back as the same double, in the four layouts the specification gives, with exponential notation only outside 1e-7 and 1e21. `%.17g` gets all three wrong. `String(x)` on anything else refuses — on `unknown` it is a general renderer, on an object it walks a prototype chain |
| `Number(x)`, `String(boolean)` | **not done** | |

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
| `do...while` | done | tests at the end, so the body runs once whatever the condition says |
| `break` / `continue` | done | a loop's exit is a merge: `break` leaves with what the body reached, not what the header held |
| `switch` | done | tested in source order, laid out in source order so a clause without a `break` falls through; `default` is reached only when every case has been tried |
| labelled statements | **not done** | a labelled `break` is *refused* rather than treated as a bare one, which would leave the wrong loop |
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
| template literals | done | a head and one span per substitution, walked left to right — which is the evaluation order and is observable. Each substitution goes through the same conversion `String(n)` does. Tagged templates are not done |
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
| generic functions | done | one copy per instantiation, found at the *calls* — the checker hands back an instantiated signature per call site, and only the body still says `T`. The substitution is recovered by matching the declaration's parameter types against the call's, which is structural and shallow: a type parameter and an array of one. Anything else leaves it unbound and refuses the call |
| a generic class extending another | **not done** | untested and certainly incomplete |
| `number \| undefined` | **not done** | no spare value in a double; needs a tag or a NaN payload |
| unions of unrelated object types | **not done** | needs a discriminant read at run time |
| optional properties (`x?: T`) | **not done** | needs a presence bit, which changes the layout |
| index signatures (`[k: string]: T`) | **not done** | keys are not known at compile time, so not a flat struct |
| tuples | **not done** | |
| `enum` / `const enum` | **not done** | four corpus files. Note for whoever implements it: node's type stripping rejects an `enum` outright (*not supported in strip-only mode*), so `nts check` cannot compare one against node — the differential has to go through emitted JavaScript, or the enum has to be tested through a function that does not mention it |
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
| `readonly` fields | done | written once, by the constructor of the object they belong to. A write through a mutable alias is still refused: the fact is what lets a field load be commoned up |
| getters and setters | done | an accessor has no storage — it is a member like a method, emitted as `Class#get x` / `Class#set x`, and `o.x` is a call. A class may declare `get x`, `set x` and a method `x`, which are three different functions. `o.x += 1` is refused: it reads through the getter and writes through the setter, and the place the assignment builds knows only the setter |
| `static` properties | **not done** | |
| parameter properties (`constructor(public x: number)`) | **not done** | refused by name since it is not a default, which it was counted as. Also rejected by node's type stripping under `erasableSyntaxOnly`, so the differential side cannot run one either |
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
| default parameters | done | filled in at the calls that omit it, which is where JavaScript evaluates it — so no test in the callee and no cost at run time. Refused when the default reads another parameter, which the call site cannot evaluate |
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
| an array of small whole numbers stored as `int32_t` | done | decided from every store in the program, and only where reading one does not go straight back into floating point |
| `Array`: `indexOf`, `lastIndexOf`, `includes` | done | `includes` uses SameValueZero and finds `NaN`; `indexOf` does not |
| `Array`: `map`, `filter`, `reduce`, `sort`, `splice`, `join`, `find`, `some`, `every` | **not done** | |
| assigning `array.length` | **not done** | needed by `som`'s `Vector` |
| `Math`: `abs`, `ceil`, `floor`, `round`, `trunc`, `sqrt`, `min`, `max` | done | `Math.round` is not C's `round`, and this one is JavaScript's |
| `Math`: `pow`, `log`, `exp`, `sin`, `cos`, `atan2`, `random`, `hypot` | **not done** | |
| `Object`: `keys`, `values`, `entries`, `assign`, `freeze` | **not done** | |
| `Map`, `Set`, `WeakMap`, `WeakSet` | **not done** | every real program needs the first two |
| `Error` and its subclasses | partial | `Error`, `TypeError`, `RangeError` and `URIError` are classes this compiler *provides* — a `message` and a `name` — because the declared interface has `stack?` and `cause?` and an optional property is refused. A subclass adds its own fields after those. `.stack`, `.cause`, `toString()` and `new Error(m, { cause })` refuse, each saying which |
| `JSON`, `Date`, `RegExp` | **not done** | |
| typed arrays | partial | `Int8Array` through `Float64Array` are ordinary arrays whose element width was written down rather than inferred, so the descriptors, bounds checks and escape analysis already work on one. A store is ECMAScript's conversion, not a C cast: `u8[i] = 300` stores 44 and `u8[i] = NaN` stores 0. Construction from a length only; the methods refuse, because the runtime's array helpers read the block as `double`. Measured: `bytes`, an Adler-32 over a byte buffer, runs at parity with the C++ reference — see record 0016 for the transfer function that was missing between them |
| `Uint8ClampedArray` | **not done** | it stores by *clamping* where the others wrap, and the wrapping conversion would be silently wrong for exactly the inputs anyone would notice |
| `ArrayBuffer`, `DataView`, `.buffer` | **not done** | a typed array here owns its storage rather than viewing storage something else can also see, which is what these are for |
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
| modules within one program | done | including a call to an imported function, and an aliased import — the call names the function's *declaration*, so `import { scale as by }` still emits a call to `scale`. Two modules may declare the same function name: `path/posix.ts` and `path/win32.ts` both have `basename`, and each is qualified by its file — `basename@posix`. Two declarations in the *same* file cannot be told apart and are refused |
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

---

## What test262 can check

**All of it, in principle** — see [`test262.md`](test262.md).

A test262 case is *self-checking*: silent on success, `throw` on failure. So the
signal is the exit code, not a compared value, and the technique is to assemble
each case the way TC39's runner does — `sta.js` + `assert.js` + a small host
preamble + any `includes:` + the test — compile the whole thing, and compare the
exit code against node running the identical script. Nothing is harvested,
nothing is substituted, no test is edited.

What stands in the way is that test262 is *untyped JavaScript* and this compiler
requires types. `function f(value)` is `any`, and `any` is refused — so every
case fails for one reason before any question of `switch` or `assert.js` arises.
Running it today would report one bug fifty thousand times. The technique is
settled and costs nothing to hold; what unlocks it is representation inference
for untyped code, which is the `unknown` work rather than a test-harness task.

The two things test262 still says nothing about: **TypeScript types** (it is a
JavaScript suite) and **anything the compiler does rather than computes** —
specialization, escape analysis, reference counting — which is right, since those
are meant to be invisible.

## Known defects

Distinct from "not done". These either produce a wrong answer or produce C that
does not compile, and in every case **the compiler reports success**. A construct
that fails quietly never enters the refusal histogram, so it never enters the
work queue either — which is how each of these survived.

**The table is empty.** It was empty for about an hour, then `"" + n` put an
entry in it, and the entry has been closed by building the instrument rather
than by fixing the one instance.

`"" + n` emitted `(NtsString *)v0`, a cast from a `double` to a pointer. Not
merely wrong: **C that does not compile**, from a lowering that reported "1
function, nothing refused". `+` resolves to concatenation from the *result*
type, which is right and says nothing about the operands. It is refused now,
naming the operand; what it needs is `ToString` on a number, and there is no
cheap version of that — the shortest decimal that round-trips through a `double`
is Ryū or Grisu, and `%.17g` is not it.

The conservation law did not catch it and could not have: the function *was*
lowered, and nothing vanished. It is a different failure mode with a different
instrument, and that instrument now exists — the corpus hands every program it
lowers to `clang -fsyntax-only`, and `UNCOMPILABLE C` is a second count that
must stay at zero beside invalid HIR.

`-fsyntax-only` asks exactly the question and skips code generation, which is
most of what compiling costs. It reports nothing today. That is not a vacuous
zero: if clang were absent the process would fail to start and *every* file
would be counted, so a zero means clang ran and accepted each one.

**Every defect recorded here has been fixed**, and there are now two machines
looking for the next one — one asking whether anything vanished, one asking
whether what came out is C.

Every defect here had the same shape — a construct that compiled to nothing, or
to a link error, while the compiler reported success — and each was found by a
person tripping over it. The Node session's suggestion turns that into a rule
worth checking: **every function the checker knows about is either lowered or
refused, and never neither.** It says nothing about whether the answer is right,
only whether anything *vanished*, and it is checkable from data the compiler
already produces.

`hir::unaccounted` asks it, and `hir::lower` enforces it: a function declaration
neither walk reached is refused rather than dropped. On its first run over the
corpus it found fourteen files, in constructs marked "not done" that were being
silently skipped rather than refused — a method of a class *expression* is the
clearest, since nothing walks a class expression at all.

It also found a diagnostic filed against the wrong node. A method whose receiver
layout fails was reported at the *class*, so a class with four bad methods gave
four identical refusals on line 1 and none inside any method. Fixed; that was
nine of the fourteen.

The section stays because the class of failure has not gone away, and the next
one will go here. What they had in common is worth keeping: each was a construct that
compiled to nothing, or to a link error, while this compiler reported success —
so none of them ever entered the refusal histogram, and none entered the work
queue.

`readonly` assigned in a constructor was the odd one out — a refusal of valid
code rather than a silent success. TypeScript permits exactly that write, and a
field nothing may ever write has no value. It is allowed now on `this`, inside a
constructor, and refused everywhere else including through a mutable alias:
`readonly` is load-bearing for the optimizer, which commons up a field load that
cannot change, and it is deliberately *not* a C `const` — see the note in the C
backend for why the qualifier was dropped.

Three were found by cross-checking and are **fixed**: bare `async` returning
`void` and discarding the value; `s += t` on strings lowering to pointer
arithmetic; and default and rest parameters lowering as ordinary ones, which
emitted a call with the wrong number of arguments. Defaults have since been
implemented rather than merely refused; a rest parameter is still refused.

The `namespace` row was fixed too, and it was also worse than recorded. The
declaration is not skipped: its members *are* lowered, under their
**unqualified** names. So

    export namespace Rect { export function area(w, h) { … } }
    export namespace Tri  { export function area(w, h) { … } }

emitted two C functions called `area` — a redefinition error with no source
location, while this compiler said "nothing refused". Two functions in one
program may not share a name now, and both are refused rather than the second,
because emitting the first and dropping the second is a program that compiles
and calls the wrong one. Overload signatures are unaffected: only a declaration
with a body counts. The verifier checks the same invariant, and finds nothing,
which is the point.

Qualifying namespace members is the actual feature and is still not done; a
*use* of a namespace is refused as before.

The object-literal method is fixed, and the cause was not the one recorded here.
`const bag = { f() {…} }` *does* have an `IDENTIFIER` child, so the symbol was
registered — as a module-scope variable whose initializer is not constant, which
is refused only when something **reads** the name. Nothing in the file did, so
nothing was said; and nothing walks into an object literal looking for methods,
so `f` was never lowered either.

The laziness is right for *data* and wrong for *code*. A constant nothing reads
is not a problem, and reporting those eagerly once took this corpus from 54
files to 25. A method is a function the author wrote. So an object literal with
a method is refused on sight, in both spellings — `{ f() {} }` and
`{ f: () => {} }` — and everything else stays lazy.

It costs two files: the corpus goes from 66 lowered to 64, because those two
were producing incomplete programs and reporting success. Three files hit the
new refusal.

`isNaN`, `parseInt` and the rest of `lib.d.ts` are fixed too, and the fix is one
line because the distinction was already in the snapshot. A `declare function`
the *program* wrote is an FFI import and stays external — the linker supplies
it, which is the point of writing one. A name declared only by `lib.d.ts` is a
builtin this compiler has not implemented, and it was emitting a prototype, a
link error and no diagnostic. The checker resolves a call to a declaration node
only when that node is in the decoded file set, which is the program's own
sources: so `target.callee` being absent *is* the test.

A fourth, found by the Node session: a class extending a type this compiler
cannot represent was laid out as though the inherited members were its own
fields. `class Bytes extends Uint8Array {}` became five `int32_t` and no bytes.
Every base in the chain is now required to be a type laid out here.

A fifth, found while implementing `Error`: a method *no class in the hierarchy
declares* still emitted a call, because the lowering fell back to the receiver's
own type for the owner. `e.toString()` became `call E#toString`, which links
against nothing — a missing symbol rather than a diagnostic. The verifier now
rejects a direct call to a function the program does not contain, so the whole
class of guessed names is caught rather than this one instance.

The verifier now also checks that a direct call passes as many arguments as the
function it names takes. It found nothing when it was added, which is the point:
default parameters are filled in at five different call paths, and a missed one
would otherwise have been silent.

## What to do next

In order, with the reason rather than the ranking:

1. **A generic class extending another**, which is all that is left of
   generics: generic functions are done, and a generic class *at* an
   instantiation was already done. `class Set2<T> extends Vector<T>` fails
   because `Vector<number>` never exists as a type — nothing in the program
   names it, only `Set2<number>` does. Two designs and an RFC-level choice
   between them, written up rather than guessed at. It gates `som`'s
   collections, which gate the five Are We Fast Yet macro benchmarks, which are
   the only real programs in reach.
2. **A representation for `unknown`**, which `docs/any-unknown.md` describes:
   chosen by whole-program analysis rather than by an annotation. It is 51 of
   `node:path`'s 131 refusals — all validators taking an argument that came from
   JavaScript — and it is the same feature that would make test262 runnable, so
   it has two reasons rather than one. Worth asking first whether `unknown` ever
   reaches more than a `typeof` test and an error message: if not, the
   closed-union case covers it and the general erased value is not needed.
3. **Enums** — four corpus files, and a `const enum` is a table of constants,
   which this compiler already has everywhere else. Note the differential
   problem first: node's type stripping rejects an `enum` outright.
4. **`Map` and `Set`** — no real program does without them.
5. **Destructuring** — declarations, parameters and assignment. The other half
   of this entry, template literals, is done.
6. **Exceptions** — `try`/`catch` with real unwinding. Large, and a prerequisite
   for promises rather than an alternative to them.
7. **Tagged unions** — `number | undefined` and unions of unrelated objects.
   RFC-level: it changes the representation of every value that can reach the
   slot.
8. **Promises and `async`/`await`**, on top of 6.

**Read the refusal histogram in the README as breadth, not as this list.** A
refusal count and the lowered count are different currencies: a file refused for
three reasons does not lower when one of them is fixed. Default parameters
cleared seven files out of that table and moved *lowered completely* by zero.
