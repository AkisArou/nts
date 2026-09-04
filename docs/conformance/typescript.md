# TypeScript language and runtime conformance

What compiles, what is refused, and what is missing entirely.

Companion to [`nodejs.md`](nodejs.md), which tracks the Node API surface, and to
[`test262.md`](test262.md), which tracks the numeric slice of the ECMAScript
suite. This file is the *language* and the *runtime under it*.

Two things it is deliberately not. It is not a conformance claim against
ECMA-262: this compiles a *typed* language ahead of time, and §13 sets out the
part of the specification that is a non-goal rather than a gap. And it is not a
plan — §15 is the plan for *coverage*, ordered by what real code is refused
for rather than by what looks incomplete, and §16 is the plan for *precision*:
the facts the checker proved that the IR does not carry.

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
| ✅ | integer `+ - *` **wrap** at 32 bits, as `(a + b) \| 0` is defined to | specialization narrows an accumulator to `int32_t` wherever the values are whole, which does not prove the sum fits. The C backend emitted a plain signed `+`, and signed overflow is undefined in C — so a long enough walk answered `3221225471` where node answers `-1073741825`, the same bits read as unsigned. Wrapped through the unsigned counterpart now. The LLVM backend was always right: its `add` carries no `nsw`. Held by a codegen text test, not by the differential, which cannot pin undefined behaviour |
| ✅ | comparison, equality | `< > <= >= === !==`, and `==`/`!=` where nothing coerces |
| ◐ | `==` that **coerces** | refused — see below |
| ✅ | logical | `&& \|\| !` |
| ✅ | `in` with a literal key | the set of types declaring the property comes from the static type, so it is `instanceof` with a different question: a constant where every arm or no arm declares it, a class test where some do |
| ✗ | `in` naming an **optional** property, or with a computed key | two reasons, both about the *key* rather than the operator. An optional property's slot exists here whether or not it was written, and JavaScript distinguishes `{}` from `{ x: undefined }` — a presence bit separate from the tag would answer it. A computed key leaves no set to test against, which needs the descriptor property table this design exists to avoid. Both refuse by name, so `"y" in o` on the same object is unaffected |
| ✅ | unary | `+x -x`, `++ --` prefix and postfix |
| ✅ | compound assignment | `+= -= *= /= %= **= &= \|= ^= <<= >>= >>>=` |
| ✅ | conditional | `c ? a : b`, nested |
| ✅ | `typeof` | folded from the representation, a branch across one absence, a tag read on an erased value — it refuses nothing |
| ✅ | template literals | including interpolation |

### `==` between types that differ

`==` and `===` agree exactly where both sides have the same representation, and
under `strict` the checker rejects most comparisons where they do not. It does
not reject `unknown == unknown`, and there JavaScript's abstract equality
converts before comparing:

```js
1 == true      // true
[1] == 1       // true — the array is converted to a primitive first
"a" == 1       // false
```

All three were answered by `nts_value_strict_eq`, so all three came back false.
Doing it properly needs `ToPrimitive`, which means `valueOf` and `toString` on
this compiler's object model, so it is **refused by name** rather than answered
wrongly.

`x == null` is not this and still works: it is the *absence* question, answered
by the tag pair for an erased value and by the null pointer for a reference. It
is also the only loose comparison real code writes — 273 in the node profile,
against **zero** uses of the refused form.

Where the type admits **no** absence at all, both operators are a constant and
neither converts anything. Abstract equality returns false as soon as one side
is absent and the other is not, before any `ToPrimitive` — so `n == null` on a
`number` is false, `n != null` is true, and no coercion was ever involved. This
was refused for a year under the coercion message, because lowering the `null`
came first and a double has nowhere to put one. Thirty-two profile sites, and
`x == null` is how TypeScript spells the nullish check.

The *comparison* is the constant, not the expression. Folding the operand away
with it made `next() === undefined` skip a call node makes — found by asking a
counter, not by reading the emitted C.
| ✅ | object and array literals | shorthand, computed keys, quoted keys |
| ✅ | member access | `o.x`, `o["x"]`, `o[0]` |
| ✅ | `new` | user classes, `Array`, typed arrays |
| ✅ | `??` | the absence test, not the truthiness one — `0 ?? 1` is `0` |
| ✅ | `??=`, `\|\|=`, `&&=` | a test and a store that happens on one path only, not `a = a \|\| b`. The right operand is evaluated inside the arm, so `a \|\|= f()` does not call `f` when `a` is truthy; the target is lowered once, so `xs[next()] ??= 1` calls `next` once. `??=` asks the absence question and `\|\|=` the truthiness one — `n \|\|= 1` overwrites a `0` and `n ??= 1` does not |
| ✗ | `??=`, `\|\|=`, `&&=` **through an accessor** | reads the getter and writes the setter, and the place knows only the setter. Refused and named; a plain `o.x = v` is unaffected |
| ✅ | `?.`, `?.()`, `?.[]` | member, call and index, through either absence or both. Two *optional* links chain — each tests its own receiver — and a **non**-optional link after an optional one is refused and named |
| ✗ | a nested object literal assigned where an **optional** property is declared | it gets its own anonymous type, laid out with a pointer where the declared one has a tagged value, and reading it back **segfaults**. Pre-existing; see the anonymous-type row in §4 |
| ◐ | spread | every shape of it in an **array literal** works — `[...a]` is a copy, and `[...a, x, ...b]` sums the lengths before allocating; `f(...a)` and `{...o}` do not |
| ✗ | `Object.keys` and `Object.hasOwn` over a type with an **optional** property | they report what an object *has*, and the slot exists whether or not it was written. Answered from the layout until now, which gave `["keep", "maybe"]` for `{ keep: 1 }` where node gives `["keep"]`. Refused by property name; a run-time answer is a loop over the layout testing each tag |
| ✅ | `delete` | TypeScript permits it only on an optional property (TS2790), which already holds `T | undefined` with a tag — so a deletion is a store of that tag. Sound because `in`, `Object.keys`, `Object.hasOwn` and `for...in` all refuse on an optional property, so nothing can see the difference from `= undefined` |
| ✗ | `void`, comma |
| ✅ | `instanceof` | against a class this program declares, or one of the four provided error classes. The set of classes that satisfy it is closed when the program is built, so it is a comparison and not a walk |
| ✅ | `instanceof` between a class and an **empty subclass of it** | `class Circle extends Shape {}` has `Shape`'s fields and dispatch table, so layouts merged them and `s instanceof Circle` was true of a `Shape`. `Layout.base` tells them apart, compared *inside* `same_shape` so neither of its two callers can forget it |
| ✗ | `instanceof` between two **empty siblings** | `Circle` and `Square` both extending `Shape` and adding nothing share fields, dispatch table *and* base, so they still merge — nts answers 7 where node answers 6. A base separates a child from its parent and cannot separate two children that differ only in name; that question is nominal, which is what the four provided error classes needed and got a nominal guard for. Found by writing the hostile case, not by reasoning |
| ✗ | tagged templates | |

## 2. Statements and control flow

| | |
|---|---|
| ✅ | `if`/`else`, `switch` including fall-through |
| ✅ | `for`, `while`, `do`/`while`, `for...of` over an array |
| ✅ | `break`, `continue`, `return`, `throw` |
| ✅ | block scope, `const`/`let`/`var` |
| ✅ | destructuring: object, array, nested, rest element |
| ✅ | `try`/`catch`/`finally`, a bare `catch { }`, and a `throw` of any type |
| ✅ | labelled `break`/`continue`, on a loop or a `switch`. A label on a *block* is refused: its `break` is a forward jump, which wants an exit with no latch |
| ✅ | `for...of` over a string — by code point, so a surrogate pair is one element |
| ✅ | a default inside a destructuring pattern, including renamed and nested. `{ a: b }` and `{ a = b }` encode identically, and are told apart by which name the binding element *declares* |
| ✗ | `for...in` — zero uses in the node profile, so it is ordered behind everything that has one |

## 3. Functions

| | |
|---|---|
| ✅ | declarations, arrow functions (both body forms), IIFE |
| ✅ | a function declared **inside a body**, including one called above its own declaration and two that call each other — the walk visits every declaration in the file, so hoisting falls out rather than being arranged. One that reads a local of the function around it is a closure, and is refused by name |
| ✗ | a nested function whose name is already taken at the top level — the namespace is flat, so both are refused. The name is not qualified by the function it is written in |
| ✅ | optional parameters, default parameters |
| ✅ | overload signatures |
| ✅ | generics, including constrained; monomorphized per instantiation |
| ✅ | higher-order functions and closures that only *read* what they capture |
| ✅ | a **named function used as a value** — one static instance, so identity holds |
| ✅ | a function held in a **field**, on a class or an object literal, called through it. `f(x): number` is a method the dispatch table holds and `f: (x) => number` is storage; the checker says which, and asking the *type* instead cannot tell them apart |
| ✅ | recursion |
| ✅ | `async`/`await` — under both providers |
| ✅ | `new Promise(executor)` where the executor is an arrow written at the call: it runs synchronously, so its body is lowered where the promise is built and `resolve(v)` *is* the fulfil. No closure, nothing captured |
| ✅ | a `throw` in an `async` function rejects the promise it owns, the way its `return` settles it |
| ✗ | an executor that is not an arrow written at the call, or a `resolve` used as a value rather than called (`new Promise(r => { saved = r })`) — both need a real closure over the promise |
| ✗ | a `catch` that spans an `await`: a rejected resumption goes to one shared exit, and reaching the `try`'s handler needs the suspension to record which handler it is inside |
| ✅ | type predicates (`x is T`) and `asserts x is T` |
| ✅ | rest parameters | the call gathers its trailing arguments into the array |
| ✅ | `function` expressions that do not bind their own `this` — the same closure an arrow is, with the same captures. One that *does* use `this` is still refused, and that is the whole of the difference |
| ✅ | closures over a variable something **assigns to** — the variable moves into a cell |
| ✗ | a closure over a `for` loop's own variable, which JavaScript rebinds per iteration |
| ✅ | a closure written *above* the declaration of a local it reads |
| ✅ | generators (`function*`, `yield`) | the `async` state machine with a different protocol: the element goes in the frame and the suspension is an ordinary `return`, because what resumes it is the caller standing there rather than the event loop. There is no `Generator<T>` object — the **frame is the iterator** |

### A written variable moves into a cell, and the cell is usually not on the heap

Escape analysis answers a store by asking about the *container*: what goes into
one is reachable from it and no further. So a cell held only by a closure that
does not escape does not escape either, and the whole pattern allocates nothing:

```c
NtsObj_Cell0 v2_frame;        /* the cell */
NtsObj_Closure0 v4_frame;     /* the closure holding it */
v4->total = v2;               /* 0 calls to nts_object_new */
```

Only a container **this function allocated** can confine what goes into it. A
parameter is already reachable by the caller, so `h.b = new Box()` inside
`fill(h)` puts the box where the caller can see it however local `h` looks from
in here. A unit test holds that case, because getting it wrong is a pointer into
a dead frame rather than a slow program.

Measured: 225 → 209 heap allocation sites across the examples. Across the node
profile it is 120 → 120, and that is the honest number — the profile's objects
are callbacks it registers and results it returns, which escape for real.

### A written variable moves into a cell, and only then

JavaScript closures capture the *binding*. For a name nothing writes to that is
the same thing as capturing the value, capturing the value is free, and that is
still what happens — it is the common case by a wide margin and it allocates
nothing.

For a name something writes to the two differ, and a program can see it:

```ts
let called = false;
const onDestroy = () => { if (called) return; called = true; };
```

Both sides have to see one `called`. So it moves into a one-slot cell, the
function and the closure both hold a pointer to it, and every read and write
goes through it. Parameters too — `callback = asRequest(callback)` before a
closure reads it is common in the profile, and missing that case emitted C that
did not compile rather than a refusal.

Refused, by name: a closure over a **`for` loop's own variable**. JavaScript
gives each iteration a fresh binding, so a closure made in the body captures
that turn's value; one cell for the whole loop hands every closure the value the
loop ended on. Verified wrong against node before it was refused. A `let` in the
loop *body* is a different declaration each time round and gets a cell each time
round, which is right without special handling.

### What a closure does not capture

A name that is reached *by name* is never captured, because there is one of it
for the whole program and copying it into a closure would be storage for
nothing: a function, a class, an import, a type, and anything at **module
scope**.

The last two were missing and it cost a whole row. `(callback as
Callback<Stats>)` mentions a type alias inside an arrow; `const BASE64 = "..."`
and `const weakSetHas = WeakSet.prototype.has` are module-scope constants. All
of them have symbols and are declared outside the arrow, so all of them looked
like captures, and the closure was refused for finding no value for a name that
never had one.

The refusal said *"a name from more than one scope up"* — 41 sites of it, and
27 were nothing to do with scope depth. It is 1 now, and what replaced the rest
are refusals at the *read* that say what the thing is: a module-scope `let`
holding a function, an enum, a builtin this compiler does not provide. A refusal
belongs where it can name the cause.

The one that remained was real, and is now done:

```ts
const onListening = () => { ...cleanup...; };
const cleanup = ...;
```

Legal, because the body runs later. There is no value to copy where the closure
is built, so the name goes through a cell whether or not anything writes to it,
and the cell is opened in the function's **entry block** — it has to dominate
both the closure that reads it and the declaration that fills it, and those can
be in different branches, so that is the one placement that always holds.

The cell is empty until the declaration runs, and a body that runs in that
window would read a zero where JavaScript throws a `ReferenceError`. This
compiler has a `throw` now, but not one the *runtime* can raise: `nts_uncaught`
prints and exits, and nothing below the lowering can reach a handler. So such a
cell carries a `ready` flag and stops the program instead:

```
nts: `later` was read before its declaration ran
```

Only a *closure* can reach that window: TypeScript rejects a direct use before
declaration in the same scope. So the flag exists only on cells that are read
from above their declaration, the check appears only inside closure bodies, and
an ordinary captured-and-written variable carries neither — its struct is the
header and the value, as before.

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
| ✅ | parameter properties (`constructor(public x: number)`) | two things wearing one syntax — a parameter, and a member initialised from it. The checker already reported the member, so the layout always had the slot; only the assignment was missing, emitted before the body because that is where JavaScript puts it and the body may read `this.x` on its first line. **Node cannot run this in strip-only mode** — a parameter property is not erasable, so the oracle refuses the program rather than disagreeing with it. The differential passes `--experimental-transform-types`, which is what `tsc` does. **No benchmark row, and the reason is measured rather than argued**: the sugared and desugared forms emit *byte-identical* C, so a row would compile the same program twice and report 1.00x by construction |
| ✅ | `abstract` **methods** — a signature with no body, terminated as unreachable. The declaration is lowered rather than skipped because a call through `Shape#area` takes its function-pointer type from it |
| ✗ | generic classes |
| ✗ | a class used as a *value* (`C` itself, passed or returned) |
| ✗ | methods and getters on **object literals** | attempted and reverted, and the blocker is not the lowering. A method is `MemberKind::Method` so the literal stores nothing for it; emitting the function and registering it in the hierarchy both work. What fails is the **name**: an anonymous object type has no canonical one, so `layout_of` invents `Type{id}` from whichever `TypeId` the builder saw first — the definition derives it from the literal's type and the call site from the annotation's, and `const s: Stepper = { step() {} }` gives the checker two ids for one shape. So the call emitted `Type14#step` against a function named `Type17#step`. Layouts merge structurally *afterwards*, which is too late for a name already baked into a callee. Needs a program-wide naming authority for structural shapes, which is its own piece of work and renames every anonymous layout. This blocks the idiomatic iterator — `return { next() { … } }` — so it is the next thing worth doing |
| ✅ | a member keyed by a **symbol** (`[kRefed]`) — an ordinary field, not a map |
| ✅ | a **method** keyed by a symbol (`[kStep]() {}`, `[Symbol.iterator]() {}`) — the same name in all three places that decide it: the declaration names the emitted function, the hierarchy answers the lookup, and the call site does the looking. Only the declaration had a rule; the field half had worked all along because a layout takes its field names from the checker's members |
| ✗ | a member name the program computes from a value the compiler cannot see |

### `[kRefed]` is a field, not a property map

`node` keeps internal state off a class's public shape with symbol keys:

```ts
export const kRefed = Symbol("refed");
class Immediate { [kRefed]: boolean | null; … this[kRefed] = false; }
```

It reads like a property map and is not one. A `const` symbol at module scope is
*one* symbol, known at compile time, so `[kRefed]` is a field with an unusual
name and costs exactly what `_refed` would.

The snapshot already reported it, under TypeScript's own spelling —
`__@kRefed@2`, the description and the checker's id, which is the name the
checker does lookup by. What was missing was only the *access* side: it had the
variable's name, `kRefed`, and looked for a field called that.

The checker's id does not survive into this snapshot, so the match is on the
description, and two symbols sharing one description on one type is **refused**
rather than guessed — the case that would otherwise pick a field silently.

Measured, because "costs exactly what `_refed` would" is a claim and not an
observation. The `symbol-keys` row writes both spellings through one object in
one loop: **1.02x C++ and 0.19x node**, where the C++ reference is a plain
struct with four fields. A property map would have separated the two halves;
they do not separate. `tooling/memory/cases/symbol-keys` is the same claim on
the other axis, at ideal 0 and allocated 0.

What is *not* there is the `symbol` type as a runtime value, and its price is
the largest single number in the profile:

    a union of `string | symbol` in a parameter        292
    a property of type `string | symbol`                25
    a function returning `symbol`                       21
    `string | symbol | undefined` in a parameter        17

`PropertyKey` is `string | number | symbol`, so it appears wherever node's
sources touch a key generically. Representing it needs a symbol to *be*
something at run time — a tag beside `NTS_TAG_OBJECT` and an interned cell
whose address is its identity — and then `string | symbol` is an ordinary
erased union. That is a feature rather than a gap, and it is the one the queue
would reach next if symbols were ranked by refusal count rather than by what the
language rests on.


### A class's identity is the layout's, and that is right until it is not

`instanceof` and `.constructor` are the two places JavaScript stays *nominal* at
runtime. `instanceof` works now; `.constructor` does not, and the reason is the
same one that made `instanceof` interesting to build.

Two classes of the same shape share one layout — deliberately, because
TypeScript is structurally typed and the two are mutually assignable, so sharing
the struct is what makes passing one where the other is expected cost nothing.
But they share the *descriptor* with it, and a descriptor is what an object
carries to say what it is:

```c
struct NtsObj_Alpha { ... };
void Beta__constructor(NtsObj_Alpha * v0, double v1);
static const NtsDescriptor nts_desc_NtsObj_Alpha = { ..., "Alpha", ... };
v3_frame.header.descriptor = &nts_desc_NtsObj_Alpha;   /* this is a Beta */
```

This was written when nothing could observe it. `instanceof` observes it: `v
instanceof Alpha` was true of a `Beta`, and an uncaught `TypeError` printed
`RangeError` — because all four provided error classes hold a `message` and a
`name` and nothing else, so all four were one layout.

The error family is fixed, by refusing to merge two *differently named provided
error classes* and nothing else. Widening that to every declared class breaks
`function-values` and `readonly`, which is structural typing doing its job: two
interfaces of one shape have to share a struct.

So the limitation stands for user classes of identical shape, and it is stated
rather than hidden: `class Alpha { x: number }` and `class Beta { x: number }`
are one descriptor, and `instanceof` cannot tell them apart. The fix is the one
this section always described — identity is nominal and wants a table of its
own, one entry per class carrying the name and the base, with the descriptor
following the class rather than the layout. What is new is that there is now a
feature that would use it.

Worth knowing before starting: of the 67 refusal sites that named a class used
as a value, fifty-nine are one idiom in the node profile —

```ts
override get ["constructor"](): unknown { return TypeError; }
```

— and the remaining eight are `instanceof` against `Error`, `RangeError` or
`Uint8Array`. The first two of those three now work; a class used as a *value*
is what the rest still want, and it is a different feature from this one.

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
| ✅ | `import def from` — default imports | `export default x` binds the name `default` in the module's namespace, so this is `import { default as d }` and needs nothing of its own. Marked ✗ until an audit of this table against the compiler tried it; the gap was a missing fixture, not a missing feature |
| ✗ | dynamic `import()` |
| ✅ | a module-scope `const` holding a function, called, passed and compared by identity |
| ✗ | a module-scope `let` holding a function — a second arrow is a second layout |

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
| ✅ | `enum` — numeric members, explicit and implicit, negative and fractional | the checker has already done the arithmetic and gives the member access a *literal* type, so `Colour.Red` is an **immediate**. There is no object: `tsc` emits a table per enum and reads a property per use, and the emitted C here is byte-identical to writing the numbers. The old note said `Colour.Red` resolves `Colour`, which is a type and not a value — true, and not the obstacle: the enum is not used as a value, the member is |
| ✅ | `const enum` | the same substitution, which is what TypeScript's own erasure of one does. A plain `enum` differs only in also emitting the reverse-mapping object, which nothing compiled here reads |
| ✗ | a **string** enum member (`Label.Short`) | a constant too, and a *managed* one — it wants the interned static a string literal gets rather than an immediate, which is a different emission. Refused by name |
| ✗ | the **reverse mapping** (`Colour[1]` → `"Red"`) | needs the table a plain enum emits alongside its members, which is the one part of an enum that has run-time existence. Refused by name |
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
| ✅ | `typeof` — including `"function"` for a closure and `"object"` for `null` |
| ✅ | `Map`, `Set` — one insertion-ordered table, keys and values as tagged values |
| ✅ | the polymorphic `this` — the receiver's own pointer, which costs nothing |
| ◐ | `bigint` — exact, and **128 bits** rather than arbitrary precision; `String()` in decimal, `BigInt()` from a number or a boolean |
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

And a pointer carries *one* absence, so comparing it strictly against the other
absent literal cannot be true however the pointer is set:

```ts
const v: string | null = …;
v === undefined      // false, always. It used to answer yes to the null.
v == undefined       // true for a null — the loose one asks about either
```

The representation cannot tell them apart; the **type** still can, and that is
what answers it.

One absence is also enough to answer `typeof`. Which of `"string"` and
`"object"` a `string | null` gives depends on what the pointer holds — a runtime
question, and the null pointer is the thing that answers it, so it is a branch
between two constants and never a tag read. This was documented here as refused,
on the reasoning that "a pointer carries no tag": true, and beside the point,
because with one absence the *nullness* is the tag. `typeof callback ===
"function"` is how an optional callback is checked, twenty-five times in node's
own sources.

Which is the other half of a wrong answer worth recording. Folding `typeof` from
the representation shipped with the closure test asking only whether the type id
was a *synthetic* closure — so a value of declared signature type, which keeps
its TypeScript function type id, answered `"object"`. node says `"function"`.
It was live for one commit. The gate did not catch it because the sweep produced
every value as an expression, and an expression's representation is its most
concrete one: `const v: Fold = (x) => x` is the closure, while `f(v)`'s
parameter is the function type. Same TypeScript type, two representations, and
only one of them was ever asked. The sweep now runs every cell twice, once on a
local and once on a value that arrived as a parameter.

A gap this opened, and what closing it cost:

`v?.length` directly on a two-absence union was refused. The receiver is erased,
and the arm the test establishes is the arm that may read the payload back out —
which lowering did not do, so the member read got a tag where it wanted a
string. Narrowing by hand worked all along (`v !== null && v !== undefined`,
`typeof v === "string"`, plain truthiness), which is what made it look like a
representation problem rather than a missing unerase on one path.

It was two refusals with different sentences and one cause: "`length` of
something without one" for a string receiver, and "a union whose members lay
their fields out differently" for an object one — said of a union containing
exactly one object.

The licence for the read-back is *not* the checker's. It narrows `v` inside an
`if`; it narrows nothing inside `v?.length`, where the only type it records is
`number | undefined` for the whole expression. It is this lowering's own: the
branch tests the tag against exactly the tags the receiver's type admits as
absences, so in the other arm what is left is the union's non-absent members,
and where those share a representation that is what the payload holds.

Measured across the node profile: **5,884 → 5,875 refusal sites**. 28 closed —
`err.stack` (15), `res.setHeader` (5), `stream.isTTY` (4),
`immediate._onImmediate` (4) — and 19 uncovered one step behind them, where the
value that now arrives meets a second wall: `String()` of an erased type (15)
and a method with no declaration in the hierarchy (4). Most of a closed refusal
is a moved one, and the count says so.

Closing it also surfaced a lifetime bug that had nothing to do with `?.` and
everything to do with two absences. Returning a *class* through
`T | null | undefined` handed the caller a pointer into a dead stack frame with
the object's fields already freed, because an erasure did not count as an escape
on a return. No example returned an object through two absences until the case
written for the refusal above did. Record 0032.

### An absent literal in an argument

`callback(null, value)` is how every node-style callback reports success, and
every one of them was refused: `null` has no representation of its own, so it
takes one from where it sits, and the argument position found nothing.

The cause was not the argument rule but the tree. `children()` flattens a
`List` node — an argument list, a parameter list — so a call's children are its
callee and its arguments, laid out flat. The `parent` link does **not**: an
argument's parent is the list, whose kind is no syntax at all. So the rule that
reads `f(null)` was looking at a node that matched none of its arms, and had
been since it was written; the comment above it claimed the case and no test
asked. `syntactic_parent` now steps over lists, which is the half of `children`
that was missing.

Under it sat a second one: a call through a *value* — `(callback as
Callback<string>)(null, resolved)` — resolves to no declaration, so there is no
call target to read a signature from. The callee's own type is a signature, and
that is the same answer reached from the other end.

### The frame's reference moves through the suspension

An async function's frame outlives the call that made it: it is handed to the
runtime at every `await` and read back when the promise settles. So the resume
**consumes** a reference — it either finishes and gives it back, or suspends and
leaves it with the runtime — and every caller provides one.

Without that the starter released the frame on its way out while a pending
reaction still pointed at it, and the resumption ran on freed memory. `hir::rc`
does not cover it: the frame is a *parameter* of the resume, and a parameter is
borrowed by that pass's convention. It is borrowed from whoever provided the
reference, which is what makes giving it back at the finishing exits — and at
none of the pausing ones — correct rather than double.

### A frame object's contents are its own to give back

A frame object cannot be *moved*. Reference counting hands ownership to a slot
when a value is stored and dies — the slot takes the reference the local was
holding, and releasing the container releases it. A frame object has no
reference to hand over: its storage ends with the frame whatever points at it,
which escape analysis is what guarantees. So a store neither takes a count nor
takes over the duty of giving the object's **fields** back.

Treating it as moved dropped that duty:

```ts
let text = "a";                                // a *managed* value
const grow = () => { text = text + "b"; };     // captured and written
```

The cell is frame-allocated — escape analysis proved it does not escape — so it
carries `NTS_IMMORTAL`, and the closure's own frame-release loads the field and
calls `nts_release` on it, which returns immediately for an immortal object.
Nothing then releases the *cell's* string. The same cell holding a number is
fine, because a number is not a reference.

The container's own release loads the field and releases the *pointer*, which
returns immediately for an immortal object, and the string the cell held was
never given up. A number in the same cell was fine, because a number is not a
reference.

Not a cost of reference counting: before escape analysis learned to put a cell
in the frame, the cell was on the heap and released normally. It was the two
changes meeting, and neither was wrong alone.

### What a program still holds at exit

`tooling/gate/rc.sh` runs every example under reference counting and records
what is live after the first case and again at the end, forcing a collection at
both. Growth between the two is a leak — agreement cannot see one, because a
function that never gives an object back answers exactly as well as one that
does.

Two examples grow and neither is a leak, which took separating rather than
assuming: `module-state` holds module-scope references, which is its subject,
and different cases set different globals; `timers` leaves one pending
60-second timer per case on purpose, and a pending timer holds its callback —
its sibling that calls `clearTimeout` shows no growth at all. Both stay listed,
because the check cannot tell state a program still needs from state it has
lost, and a *change* in either number is worth stopping for.

### There are two backends now, and they agree

`compiler/codegen/llvm` renders the same HIR as textual LLVM IR, fed to
`clang -x ir`. Textual rather than a linked `llvm-sys`, for the reason the C
backend has earned: reading `program.c` diagnosed three separate bugs in one
week, and an IR nobody can read gives that up. It also avoids pinning an LLVM
version into the build.

The C backend does not go away. It is the **oracle**: one HIR, two renderers,
and a disagreement between them is a backend bug *by construction* — the
program, the lowering, every optimisation and the runtime are identical, and
only the rendering differs. Nothing else here can isolate a backend that way;
the differential compares against node, which is the right oracle for semantics
and says nothing about which renderer was wrong.

That this is possible at all is a consequence of where suspension lives.
`hir::suspend` turns a suspending function into a state machine in the *middle
end*, before any backend sees it, so the C backend can express `async`. scriptc
put suspension in the backend, so theirs cannot — their C output is debug-only
and their LLVM output has no second opinion.

What is rendered so far is the scalar slice: numbers, integers and booleans,
arithmetic, comparison, conversions, direct calls, and control flow. Anything
managed is refused by name. The one structural difference between the IRs is
block parameters: HIR puts arguments on edges the way MLIR and SIL do, LLVM puts
the join in the successor as a `phi`. They carry the same information and the
translation is mechanical, which is a large part of why the lowering chose block
parameters in the first place.

Two things the move has already taught:

- **A `static inline` in a C header is not a contract another backend can
  read.** `nts_to_int32` is thirty-one such helpers' worth of the runtime, right
  for C — every translation unit gets ten instructions instead of a call — and
  invisible to a code generator that is not a C compiler. The inline stays and a
  linkable form stands beside it. What the runtime *offers* has to be linkable.
- **`#` is in every name this compiler invents** — `fib#whole`, `Closure3#call`,
  `module#init` — chosen because TypeScript cannot produce one. LLVM identifiers
  cannot hold it unquoted, so the quoted form is where that is absorbed.

Objects are rendered too, and that is where the layout engine stops being
merely checked and starts being load-bearing. The C backend writes `p->x` and
lets clang place it; the IR has no `p->x`, only `getelementptr i8, ptr %p, i64
24`, and the 24 came from `place()`. If the two disagreed about an offset they
would read different bytes of the same object.

The test drives both backends over the differential's own hostile pool — both
zeroes, both infinities, a NaN, past 2^53, the 1e21 boundary — with the runtime
linked into both, which is also the only place the C-to-LLVM ABI is exercised.

Two things that test taught, and both are about not assuming:

- **A field's representation is specialized.** The driver first wrote the struct
  out by hand and got it wrong: `y: number` is an `int32_t` in the emitted
  layout, because specialization narrows a field like any other value. The
  driver names no field now — every one is written and read through the program.
- **The ABI is taken from clang, not derived.** `clang -S -emit-llvm` on the
  same declarations prints `zeroext i1` for a `_Bool`, `signext i8` for an
  `int8_t`, and nothing for anything word-sized. A bare `i1` happens to work on
  x86-64 because both ends use the low bit of a register; "happens to work" is
  not an ABI, and the runtime this has to agree with is compiled by clang. The
  extension attributes are copied from what clang prints.

`NtsValue` by value was the part of the ABI that was not settled — a sixteen-byte
struct in seventeen runtime signatures — and it is settled now, by asking rather
than reasoning. `clang -S -emit-llvm` on a function taking one prints:

```llvm
define dso_local { i32, i64 } @passthrough(i32 %0, i64 %1)
```

Two separate scalar arguments in, a two-field struct out. The System V rule
classifies the sixteen bytes as two eightbytes, and the *second* is `i64` rather
than `double` because the union holds a pointer — which is exactly the detail a
careful reading would have got wrong, and the reason this was refused rather
than guessed at. An erased value is still refused in the backend until it is
built to that shape, but the shape is no longer unknown.

Descriptors, arrays, module-scope globals and reference counting followed, and
**67.8% of the 915 functions across `examples/` now render**, from 36.2% when
calls into the runtime first worked. A descriptor is the one piece of the
runtime a backend has to *build* rather than call — it is data the collector
reads — and it is emitted as LLVM's own struct type with the runtime's field
types in the runtime's order, so the two agree by construction rather than by a
hand-computed offset. What goes *in* one was already shared: `cyclic_layouts`
and `reference_fields` are the middle end's, the offsets are the layout
engine's, and only the rendering belongs to a backend.

Three more things the second backend has forced into the open, each of which was
a single-backend assumption:

- **The symbol name is part of the ABI.** `module#init` became `module__init` in
  the C output and `@"module#init"` in the LLVM output, so a driver could link
  against exactly one of them. The mangling — reserved words, header collisions,
  punctuation no C identifier may carry — moved to
  `nts_codegen_common::symbols` and both backends read it. It is still *C's*
  rule, and that is right: the linkage name has to be one every toolchain on the
  way to an executable can carry, and C's is the narrowest.
- **A `static inline` is not a contract.** `nts_check` and `nts_index` joined
  `nts_to_int32` in having a linkable form beside the inline. Reproducing a
  bounds rule in a second place is a second implementation to keep in step.
- **A field's representation is specialized**, so nothing outside the program
  may assume `number` means `double`.

### The definition of a valid program was a description of one backend

`verify::compatible` called any scalar compatible with any other, and the
comment above it said why:

> Two scalars are a conversion the backend already emits: a field narrowed to
> `i32` by specialization is assigned from a `double` and C converts.

That is a true statement about C written into the definition of a valid
program. It means the IR was *within its rights* to store a `double` into an
`i32` field, send an `i32` along an edge into an `f64` parameter, or hand a
`double` and an `i64` to one `+` -- and the only backend that ever had to notice
was the one that could not convert silently.

Making the rule exact and counting what fell out:

| | examples (89) | corpus (184) |
|---|---:|---:|
| before | 18 fail | 5 fail |
| after `reconcile_stores` and `reconcile_edges` | **0** | **0** |

Two kinds, and both are the same story. **`StoreType`** -- a field, an array
element, a global -- is specialization narrowing a *slot* and the *value* that
fills it independently, with nothing putting them back together. **`EdgeType`**
is a block parameter taking an `i32` where it declares `f64`; `specialize`
already unions a parameter with every argument feeding it, so only three
survived that union, and the conversion has to land in the **predecessor**,
because that is the only place both the value and the branch exist.

### Three things nothing was checking at all

Tightening the rule exposed which questions had never been asked. Each was added
as a check and then measured, because a check that has never fired is a claim
rather than a fact:

| new check | fired |
|---|---:|
| a binary's two operands agree with each other | 0 |
| a binary's result agrees with its operands | 0 |
| an array *read* agrees with the element type | 0 |
| **a direct call's result is what the callee returns** | **6** |

The zeros are worth as much as the six. The LLVM backend carried a copy of C's
usual arithmetic conversions to pick a type for a mixed-type `+`; the IR turns
out never to produce one once the stores are reconciled, so the mismatched `fadd
double %v25, %v33` that started it was the *store* bug propagating, not a
separate defect. That code is gone rather than kept "just in case".

The six are the 14x closure. Nothing said a call's result must be what the
callee returns, so specialization narrowed the result at the call site and left
the callee alone. It is explicit now: the call yields the callee's type and a
`Convert` narrows it.

### What the backends stopped deciding

Deleted from `compiler/codegen/llvm`, because the IR now guarantees it:
`usual_conversion` and `at_joint`, the edge conversions in `edge_value` and
`outgoing_conversions` (the whole of the second), the element conversions in
`element_access`, and the direct-call argument and result fixups. The C backend
had no code to delete -- its compensation *was* C, an implicit conversion at
every assignment, and it simply stops happening.

**What stays, and it is not compensation.** `helper_operand` and the conversions
around calls to the runtime are the boundary between our types and C's declared
ones: `nts_array_new(ptr, double)` wants a `double` length whatever
specialization narrowed ours to, and no amount of tightening the IR changes what
that function's signature says. The earlier plan listed those for deletion and
that was wrong -- an ABI boundary is not a backend making a decision it should
not.

The LLVM gate row went **56 to 60** on the tightening alone, before any deletion:
four examples the second backend had been getting wrong were programs the IR had
never been explicit enough to state.

### What a sharing slice would be worth, and why not yet

`substrings` is the worst row against hand-written C++, and the reason is in the
case's own comment: `std::string_view::substr` returns another view of the same
characters and allocates nothing, while every string this compiler makes owns
its bytes.

Before designing that, measure the ceiling. The same reference, once with
`string_view` and once with `std::string`, on one driver:

| word length | view | copy | penalty |
|---:|---:|---:|---:|
| 6 (this case) | 2.47us | 3.86us | **1.56x** |
| 20 | 9.63us | 12.39us | 1.29x |
| 60 | 18.25us | 21.72us | 1.19x |

Two things fall out. The copy is worth about **1.56x** on the shape this
benchmark has, so a perfect sharing slice would take the row from 2.10x C++ to
roughly **1.35x** -- most of the gap, not all of it. And the penalty *shrinks*
as words grow, because the scan that finds the boundaries is O(text) and it,
not the copying, is what a long-word parser spends its time on. Note also that
`std::string` at length 6 is inside its small-string buffer, so the C++ "copy"
column is a copy *without* an allocation -- which is what frame placement
already buys us.

**Decided: not now.** A slice that shares storage is a change to the string
representation itself -- a data pointer and an owner reference where there is
now inline data -- and it reaches `NTS_ELEMENTS`, every helper that walks
characters, reference counting (a slice keeps its owner alive), and
`nts_str_place`, whose whole trick is that the caller already has the storage.
1.35x is worth having and it is not worth having before the second backend can
render a closure or a suspension. The measurement is here so the decision can be
retaken rather than re-argued.

### Why the awfy family is slow, and it is two things

Five of the rows above 1.20x are one family -- small classes, and the C++ port
declares their coordinates `int32_t` where we declare `double`. `Ball` is 56
bytes of doubles against four `int32_t`. `fields::representations` exists to
prevent exactly this and its own comment names the case, so the question is why
it does not fire.

Isolating says it is two independent causes:

| | |
|---|---|
| `Plain` alone -- one field, assigned `7` in the constructor | **`int32_t`** |
| `Plain` beside an unrelated `SelfRef` with the same field shape | `double` |
| `SelfRef` alone -- `this.v = this.v + d`, then clamped | `double` |

**Structural aliasing is too coarse.** `shares_storage` matches on a field's
*name and type* along the prefix, so two classes that share no relationship at
all are treated as aliasing storage, and one class with an unbounded field drags
every similarly-shaped class down with it. The rule is justified as "exactly
when a pointer to one is a pointer to the other", which is true of base-first
*inheritance* -- but it never asks whether the two are related, only whether
they look alike.

**A self-referential field never tightens.** `this.v = this.v + d` reads the
field, so on the first round the store is computed from `Facts::TOP` and is
therefore TOP -- and TOP is a fixed point. `nts facts` shows it plainly:
`field.get %0.0` is `[-inf, +inf] nan?` in `Ball#bounce` while
`Ball#constructor` is 16/16 provably `i32`. `Random.seed` escapes only because
its update ends in `& 65535`, which bounds the store whatever the input was --
which is why field narrowing looked like it worked.

The clamp `if (this.x > 500) this.x = 500` does bound it, and believing that
means knowing what the field holds at function *exit* rather than joining every
store regardless of order. That is a flow-sensitive field analysis, not a
narrowing iteration, which is what I first prescribed.

**Only one of the two is worth spending on.** Checked across all 26 benchmark
cases: **no two layouts share a prefix** by accident, so the coarse aliasing
costs nothing measurable here. It is still wrong, and it will bite the first
program that has two unrelated classes beginning with the same field -- which
is not a rare shape -- but the awfy cluster is entirely the second cause.

And widening to a threshold is not the shortcut it looks like. Jumping to the
`int32` bounds instead of infinity would make `width_for` accept the field, but
widening is only sound when what it jumps to contains the true range, and
nothing here proves that. Thresholds need a descending pass afterwards to
confirm the result is a post-fixpoint; without it the answer is a guess that
happens to typecheck.

### `!invariant.load` is not what `readonly` means

`Field::readonly` is "never written after construction, semantic not syntactic,
so `Readonly<T>` counts", and its own comment lists *hoistable loads* among what
it is for. So `!invariant.load` on those loads looks obvious.

It is unsound. Given a load, a call that writes through the same pointer, and a
second load, LLVM folds the second into the first:

```llvm
  %a = load double, ptr %p, !invariant.load !0
  call void @construct(ptr %p)
  %s = fsub double %a, %a          ; the second load is gone
```

The metadata licenses "the same value at **all** points where the location is
dereferenceable", and for us that includes the zero an allocation leaves before
the constructor runs. `hir::fields` says as much about itself: *"Zero is joined
in as well, because that is what an allocation leaves. A well-typed TypeScript
program cannot read a field before its constructor writes it, but proving that
here would mean a definite-assignment analysis."* We assume it; we do not prove
it, and this metadata would be relying on the proof.

The tool for "written once at construction, invariant after" is
`!invariant.group`, which is what clang uses for vtable pointers and which is
scoped to handle exactly the construction window.

And there is nothing to measure it on: **no benchmark case uses a `readonly`
field**, by keyword or otherwise. An optimization with no case that exercises it
is a claim, so the case comes first.

### A closure was 14x slower, and the reason verified cleanly

With both backends in one bench run, `closures` came out at **16.33us through
LLVM against the C backend's 1.13us** -- same HIR, same machine, same run, same
checksum. Fourteen times, on a one-line arrow function.

The module says it plainly once you look:

```llvm
define internal double @Closure0__call(ptr %v0, double %v1) nounwind {
  ...
  ret double %v20
}
...
  %v17 = call i32 @Closure0__call(ptr %v5, double %v34)
```

Defined `double`, called `i32`. The definition took its types from the callee's
`Func` and the call site took them from the *operation*, and nothing reconciled
the two -- the signature table answers exactly this question for the runtime,
and nothing answered it for our own functions.

It is the ABI mismatch it looks like: the callee returns in `xmm0` and the
caller reads `eax`. And LLVM verified it without complaint, because with opaque
pointers a call carries its own signature and is entitled to disagree.

The cost is not only correctness. **LLVM cannot inline a call whose signature
disagrees with its callee**, so a closure that should have vanished stayed a
real call in the innermost loop, twice over. Taking a direct call's types from
the callee -- the same thing the table already does for the runtime -- put it at
**1.13us, level with the C backend and 1.01x hand-written C++.**

A scan of every emitted module for the same shape now reports zero. It is worth
keeping in mind that it was *silent*: it verified, it linked, and it agreed with
node. The only instrument that saw it was a second backend measured beside the
first on the same program.

### The bench measured one backend, and the other one was full of holes

`tooling/bench` compiled through the C backend and only the C backend, which
was right while there was one of them. Running the same 25 cases through the
second, at `-O2 -flto`, **five ran and twenty did not** -- against a gate that
said green with 49 of 88 examples carried.

The gate was not lying. It was answering a different question. An example that
fails to *build* and an example the backend has not learned both count as "not
carried", so 39 refusals hid a dozen broken modules among them. A number that
cannot tell "I decline" from "I emitted nonsense" will report the second as the
first for as long as you let it.

Every one of the bugs is the same shape, and it is the shape this whole
exercise keeps finding: **C converts silently and a module has to say it out
loud.**

| what clang said | what was wrong |
|---|---|
| answered `1.3186118021857029e-314`, node said `2668900000` | `ArraySet` took its element type from the **stored value**, not the array |
| `fadd double %v25, %v33` with `%v33` an `i64` | binary operands never met at one type |
| `use of undefined value '@Benchmark__innerBenchmarkLoop'` | a *refused* function was still called |
| `use of undefined value '@nts_to_uint8'` | a `static inline` has no symbol and no table entry |
| `'%v22' defined with type 'i32' but expected 'i64'` | `ToInt32` hardcoded an `i32` result |
| `nts_unit_fn(ptr, i32 %v46)` with `%v46` a double | `StringUnitAt` hardcoded `double` both ways |
| `zext i32 %v2 to i32` | `int32_t` to `uint32_t` is a conversion in C and nothing in LLVM |
| `nts_array_new(ptr, double %v1)` with `%v1` an `i32` | the signature table had exactly one reader |

Eighteen of the twenty are now clean refusals and the other two run. Two of them
deserve their own paragraphs.

### An `i64` and a `double` are the same eight bytes, and only one is right

`erasure-stored-typed` answered `1.3186118021857029e-314` where node answered
`2668900000`. That is not a rounding difference; it is `2668900000`'s bit
pattern read as a double.

`ArraySet` chose the type of the *value being stored* rather than the type the
array holds. Specialization had narrowed the value to an `int64_t` while the
array's descriptor still said eight-byte doubles -- so the store was `store
i64` into memory every reader loaded as a `double`. **The widths matched**, so
nothing crashed, nothing was diagnosed, and the answer was wrong.

The C backend cannot make this mistake, and not because it is more careful:
it writes `elements[i] = value` through a `double *`, so C converts on the way
in. The element type now comes from the array, and the conversion is written
down.

### A refusal has to look like a refusal

Seven benchmarks failed with `use of undefined value
'@Benchmark__innerBenchmarkLoop'`. The callee needed a method table and was
refused; the *caller* rendered fine and called it anyway. A module that
references a name nothing defines is not a module -- clang rejects the whole
file, so one refused function took out everything.

A refused function gets a `declare` now. The module verifies, the link fails,
and the error names the function that was not built -- which is exactly where
the C backend has always put it, because C emits a prototype for everything and
lets `ld` say what is missing.

The `_fn` distinction came back too. `nts_to_uint8` is `static inline` in the
header: no symbol to link against, and no row in the generated table because
the table is built from what clang *declares*. Emitting the call anyway made a
broken build out of what should have been a refusal. A call to a helper the
table does not carry is refused now, for the same reason `nts_to_int32_fn`
exists at all -- **a `static inline` is not a contract another code generator
can read.**

### A generated file with no generator, and a check that did not check

`src/signatures.rs` said it was generated and nothing generated it: it was
produced once, by hand, out of band. `NTS_REGENERATE=1 cargo test -p
nts-codegen-llvm --test signatures` writes it now, from the same parse that
checks it, so the two cannot answer different questions.

The check had a hole of its own. It compared return types and parameter types
and *not* attributes -- the part worth 5x. An attribute that stopped being
emitted would have cost that with every test still green. It compares them now.

And it skipped too politely. Failing to compile the probe returned "no
toolchain", which is what a missing clang looks like; a broken header looked
exactly like a machine without a compiler. Clang absent still skips. Clang
present and refusing now fails, with what it said.

### `nts emit-llvm` printed nothing about what it had refused

`emit-c` reports the lowering's diagnostics and `emit-llvm` reported only the
backend's, so a module with two refusals in it -- a top-level loop assigning a
module-scope name, and a `console.log` -- printed an empty `module__init` and no
explanation. It looked like a backend that had rendered everything asked of it.
It reports both now.

The same shape as `uncompilable C` being 15 and invisible: the number was not
wrong, nothing printed it.

### The second backend runs the whole differential

`NTS_BACKEND=llvm` drives every example, every case and the same hostile pool
through `compiler/codegen/llvm` and compares against **node**. That is a
stronger net than comparing the two backends to each other on a handful of
fixtures — node is the oracle either way, and two backends that both agree with
node agree with each other.

An example is either wholly rendered or not attempted, because a function the
backend has not learned is absent and the driver would fail to link. So the
number is *examples carried*: **49 of 88**, and the gate ratchets it upward. The
direction matters. The C backend's match is exhaustive, so adding an `OpKind`
breaks its build; this one has a fallthrough that refuses, which is safe and is
exactly how a second backend silently falls behind.

### An attribute is a promise, and it is worth 5×

The C backend gets facts for free that an LLVM module has no way to know.
`NTS_READS_ONLY` is `__attribute__((pure))` on twenty-nine runtime
declarations, and the header explains why it is not decoration:
`text.indexOf("brown")` inside a loop is loop-invariant, and a compiler may hoist
it only if it knows the call has no side effects. Generated C carries that fact
because it includes the header. A module includes nothing.

Measured on exactly that program, three million iterations:

| | time |
|---|---|
| with `nounwind willreturn memory(read)` | **2.29 ms** |
| without | 12.31 ms |

Same checksum. The attributes come from clang rather than a manual — `pure` maps
to `nounwind willreturn memory(read)`, and that mapping is clang's business —
and they are carried in the same generated table as the signatures.

One of them had to be taken *away*. `nts_check_fn` was declared
`NTS_READS_ONLY`, which clang turns into `willreturn` — and a bounds check that
fails does not return, it aborts. That would have licensed hoisting a trap out
of the branch guarding it. An attribute is a promise, and a promise that is
nearly true is worse than none.

### An attribute the header states once, and both backends get

`nts_object_new` and its five siblings always return a *fresh* object: never
null, reachable through no pointer the caller already holds. Written in the
header as `__attribute__((malloc, returns_nonnull))`, that reaches generated C
because C includes the header and reaches the module because the signature table
is generated from what clang says. One place, both backends.

**Measured, and it bought nothing.** On an allocating loop -- four million fresh
two-field objects, each written and read -- 0.23s with the promise and 0.23s
without, same checksum. Adding the stronger claim by hand (`memory(argmem: read,
inaccessiblemem: readwrite)`, which is how LLVM models `malloc`) also changed
nothing. The reason is the honest one: the allocation call *is* the cost, and no
promise about what it does short of deleting it changes that.

It stays because it is true and free, and because `noalias` pays in shapes that
have not been written yet. But it is recorded as a measurement rather than a
win, because "the attributes are worth 5x" was a real number from a real
program, and this is not that.

Applied only where the definition allocates unconditionally -- and the
exclusion that matters is the `_into` family, which returns storage its *caller*
supplied. That is a pointer the caller already holds, which is exactly what
`malloc` promises cannot happen.

The first version of that reasoning was invented rather than read. It said
`nts_str_slice` may hand back its argument and `nts_tag_name` returns one of
seven static strings; neither is true -- `nts_str_slice` routes through
`nts_str_raw` and allocates every time, and `nts_tag_name` builds a fresh string
on every call. The functions excluded were still the right ones, by luck rather
than by the reason given, which is worth writing down: a promise that is nearly
true is worse than none, and so is a reason for one that was never checked.

### `nsw`, exactly where clang puts it

`int32_t` overflow is undefined in C, and `Int { bits: 32, signed: true }` is
`int32_t`. So the C backend has always been compiled under the stronger
assumption -- clang writes `add nsw i32` for it -- while the LLVM backend wrote
a bare `add`. That is a divergence in the direction nobody wants: the *primary*
backend giving up an optimization the reference implementation already takes.

Which operations carry it is read off clang rather than off C11 6.5, for the
same reason the signatures are:

| | |
|---|---|
| signed `+` `-` `*`, unary `-` | `nsw` |
| unsigned `+` `*` | nothing |
| `<<`, `/`, `>>` | nothing, even signed |

There is no `nuw` anywhere and its absence is the point. Unsigned overflow in C
is *defined* to wrap, so `nuw` would be the one place this backend promised more
than its oracle does.

### A read-only array loop is at parity, and the counter is not the reason

A `for (let i = 0; i < xs.length; i++)` counter stays a `double`, because
`xs.length` is a `uint32_t` and does not fit an `int32_t` -- so the loop pays a
`fptoui` per element and carries `fadd double %i, 1.0` instead of an integer
induction variable. That looks like it should cost something.

Against the same loop written by hand in C++ over a `std::vector<double>`, four
thousand elements, twenty thousand rounds:

| | time |
|---|---|
| nts, through LLVM | 0.05s |
| hand-written C++ | 0.06s |

Same checksum. The accumulator is a chain of dependent `fadd`s, four cycles
each, and neither compiler can vectorize a floating-point reduction without
being told it may reassociate. The counter's type is not the wall; the
arithmetic is, for both. A narrower counter is still worth having for the loops
that are not reductions -- but it is not the thing standing between this and C++
here, and it would have been easy to spend a day believing it was.

### What may alias what, and a measurement that was too short to show it

Add a *store* to that loop -- `xs[i] = xs[i] * k` -- and it changes character.
The element block pointer and the length both live in the array's header,
reached through the same parameter, so a `store double` may for all LLVM knows
have overwritten them: they are re-loaded on every element.

The generated C does not have this problem. C's rule is that two accesses of
different types do not alias, so clang hoists the `uint32_t` length and the
element pointer out of a loop that only writes `double`s. **A module carries no
types at all once it is written.** `store double` and `load i32` are both just
bytes.

The first measurement said there was nothing here:

| | 20k rounds |
|---|---|
| LLVM backend | 0.04s |
| C backend | 0.04s |
| hand-written C++ | 0.03s |

Three numbers at 10ms resolution, which is not a measurement of anything -- 0.04
and 0.04 could be 0.035 and 0.044. Twenty times the work:

| | 400k rounds |
|---|---|
| LLVM backend, before | 0.85s |
| LLVM backend, with `!tbaa` | **0.78s** |
| C backend | 0.78s |
| hand-written C++ | 0.58s |

So the gap was 9%, it was **to our own oracle rather than to clang**, and a type
tree closes it exactly. The lesson is the older one: a number whose resolution
is the same size as the effect is not evidence, and "they came out equal" is the
easiest wrong answer to accept.

The remaining 0.78 against C++'s 0.58 is shared by both backends and is a
different question -- C++'s `vector` is a local whose address never leaves the
function, so its size and data pointer cannot be disturbed by anything at all,
where our array arrives as a parameter.

Only types, not fields: LLVM's struct-path TBAA would additionally say `Point.x`
and `Point.y` do not alias, which is where soundness stops being obvious, and
the plain type rule already recovered the whole difference. `i8` deliberately
has no node -- it is the omnipotent char and aliases everything, which is what C
says and what string data is.

**The tree is clang's, and the first one was not.** It invented a root,
`!{!"nts"}`, and the worry about that turned out to be backwards. The fear was
unsoundness under `-flto` -- which `tooling/bench` uses -- from two trees
describing the same memory. The experiment says otherwise: a loop that loads a
`double` and stores an `int` through an unrelated pointer has its load hoisted
clean out when both tags sit under clang's root, and moves *nothing* when the
store's tag has a root of its own. Unrelated roots are treated as possibly
aliasing.

So an invented root is safe and **useless across a translation unit**: every tag
the runtime carries would be opaque to every tag we emit, and under LTO -- where
the runtime is finally visible and there is most to gain -- it would have gained
nothing. Metadata nodes are uniqued by content, so spelling the tree exactly as
clang spells it makes our `double` node *be* the runtime's. The names are not
guessable and were read off clang: `int8_t` and `uint8_t` are character types
and get the omnipotent char, signed and unsigned share a node so `uint32_t` is
`"int"`, `int64_t` and `uintptr_t` are both `"long"`, and `_Bool` keeps its
underscore.

`NtsValue` gets the char node rather than one of its own, because it is a union
in C and this is not the place to make a claim about one. Measured on an erased
field read inside a storing loop, giving it a distinct node was worth nothing,
so the conservative choice is free.

What makes it sound is that every field is accessed at exactly one LLVM type:
the type comes from `field_at`, off the field's HIR type. An erased value is
read and written whole, as `{ i32, i64 }`, never as a `double` through one path
and an `i64` through another -- the one place a union could have made this a
lie.

### Two things C was doing silently

Both found by assembling what the second backend emitted, and both are facts
about the *middle end* rather than about either backend.

**The IR is under-specified about edges.** `verify::compatible` treats any
scalar as compatible with any other, so specialization may send an `i32` along
an edge into an `f64` block parameter. The C backend writes `v7 = v0;` and lets C
convert; a `phi double` taking an `i32` is not a module. The conversion is
written out now, in the predecessor, because that is where a phi's incoming
value has to be available.

**And about call results.** `nts_str_index_of` returns a `double` into an
`int64_t` slot, and C converts without a word.

Neither was wrong in the C output. Both were places where the IR relied on a
property of C rather than stating what it meant, and only a second backend could
have found them.

### `this` is a free variable of an arrow, and was the only one not treated as one

Two rows in §15 looked like the case for structural dispatch: "a member `X`
which `Y` does not declare" at 72 sites, and "a method `X` with no declaration in
the hierarchy" at 64. Counting what was behind them says otherwise. They are one
bug, and it is not about interfaces.

An arrow does not bind `this`; it inherits the enclosing method's. Inside a
lowered closure `this` was the *closure object* — parameter zero of its `call` —
so a body saying `this.emit(...)` looked for `emit` on the closure's own layout
and did not find it. The same sentence about a field reads "`v`, which `an
anonymous type` does not declare", which is why the two rows never looked
related. Seventeen of them were `this.emit` inside a callback, which is how
every stream in that codebase reports an error.

```ts
nts_net_read_start(this._handle, (bytes) => this.#inScope(() => { … }));
```

`this` travels as a capture like any other name now, first in the closure object
so its field index is stable. The machinery was already there — `mentions_this`
knew to stop at anything that rebinds `this` and to descend through arrows,
which is exactly the rule — it had only ever been used to explain a refusal for
`function` expressions.

The rows went 72 → 62 and 64 → 37, and the profile 1,095 → 1,065. What is left
of them is the part that really is structural.

This is the sharpest instance yet of the rule that a tall row is usually one
thing repeated. The plan was to build an interface dispatch table for these
sites. Ninety-three of them wanted a capture.

### A hundred objects that were all the same object

Escape analysis asks where a reference can be *reached from*. That is the right
question and it is not the only one. A frame allocation is a single slot, so
confining one is also a claim about *lifetime* — that at most one of its results
is live at a time. True of a straight-line `new`; false of one inside a cycle,
where the slot is reused and whatever kept the previous result is now looking at
the current one.

```ts
const balls: Ball[] = new Array(100);
for (let i = 0; i < 100; i += 1) {
  balls[i] = new Ball(random);   // one frame slot, a hundred objects
}
```

Every element pointed at the same slot and read back the last ball. The store
rule deferred the stored value's escape to the container's, the container was a
frame-local array, so the ball stayed in the frame — reachability said yes and
lifetime said no.

Found by `awfy-bounce`, which checks its own answer against the constant Are We
Fast Yet recorded: **1117 where node says 1331**. It had been failing in the
benchmark runner and the benchmark runner is not part of the gate. Nothing in
`examples/` stored into a container in a loop, so nothing else asked.

An allocation in a cycle can no longer be confined when something keeps it. A
block is in a cycle when it can reach itself, which is all this needs to know —
not which loop, not how many iterations — and it is used only to *refuse*
confinement, so over-approximating costs a heap allocation and never an answer.

It cost nothing where the analysis exists to help: `objects` 1.00x of
hand-written C++, `closures` 1.01x, `pipeline` 0.97x, `awfy-list` 1.08x, all
unchanged. An object allocated in a loop and *not* kept still lives in the
frame, and `examples/objects` now pins all three cases.

### A crash and a declined case are not the same thing

Twice this week the harness reported agreement over a program that had died.
`examples/map-and-set` segfaulted on every case under reference counting;
`examples/async` reached 263 of its 928 cases for the same reason, with the
cycle collector's blind spot sitting behind it. Both were filed as *declines*,
which do not fail a run.

The rule that was missing is narrow and exact. A decline is the program refusing
its input, and it **says so** -- `nts: refused: …` on stderr before it stops, so
a bounds check that aborts is still a decline. What was not distinguished is a
program killed by a signal that printed nothing at all. That is a crash, and it
now fails.

A timeout stays a decline: `timeout` exits of its own accord, so there is no
signal on the child, and a case that takes too long is not reached rather than
wrong.

The classification is a function with a test, which the version it replaces was
not: five cases, one per way a run has actually ended. And it was checked the
only way worth checking a detector -- by putting the collector bug back and
confirming the run fails, where the same program had previously reported
"agreed on every case".

### What the `rc` list was counting

It named `invalid`, `timers` and `unsupported`, and only one of those was about
reference counting.

`invalid` does not typecheck and `unsupported` is a refused construct. Both are
fixtures that must *fail*, and `gate.sh` has always inverted them for exactly
that reason -- the `rc` sweep did not, so two entries on a list of known
reference-counting failures were programs that would fail under any provider.

`timers` held 58 objects at the end: 29 cases times a pending 60-second timer
and the callback it had not run. The note beside it said "not a leak", which was
true and was not a *separation*. A pending timer is the **host's** state, and
the check claims to measure what the program still holds; the host was never
asked to give it back. The driver now drains the host before it measures, so the
number means what it says, and it is 0.

`module-state` came off earlier and was the reverse case: its note explained the
extra object as an artifact of taking the baseline too early, and it was a real
bug -- a module-scope initializer refused and silently dropped.

The list is empty and 90 of 90 examples pass under reference counting. Which is
worth one caution: an empty list is only as good as the check behind it, and
this same week that check reported "agreed on every case" over a program that
segfaulted before printing a line.

### The collector's blind spot was its own dying list

`allOfTwo` returning 0 where node returns 1 was the symptom this was tracked
under, and by the time it was looked at properly the wrong *answer* was gone --
it returns 1. What was left was worse and quieter: `examples/async` under
reference counting **checked 263 of its 928 cases and reported "agreed on every
case"**, because the driver was segfaulting and the harness gave up after
seventeen restarts.

One ASAN stack named it:

```
nts_collect_at_checkpoint -> nts_collect_cycles -> nts_destroy
  -> nts_release_contents -> nts_each_reference -> nts_release   [faults]
```

faulting on the values array `Promise.all` writes into.

`nts_destroy` links an object onto the dying list by storing the list's next
pointer **in the count word** -- there is nowhere else to put it, and the object
is going away. So a release arriving afterwards decrements a *pointer*. That
arrives constantly rather than rarely: `nts_release_contents` on one dying
object walks a field pointing at another, and the collector puts every
zero-count black root through the same drain in one pass, so two objects that
die together each release the other. The list ran into freed memory and the next
walk read it.

`nts_retain` and `nts_release` now ignore an object already on the list, marked
with a flag rather than inferred from the count word -- the flags are the only
part of the header still saying what the object is. Ignoring the release is
*right* rather than merely safe: the object is being freed either way, and the
reference being given up is one the destroy already accounts for.

928 of 928 cases now.

The route the collector could not walk was not the microtask queue, which was
the standing suspicion and is written up below as one. A queue is indeed no
object at all, and `nts_promise_schedule` does move a reaction's state into one
-- but it *moves* it, count and all, and a reference held outside the object
graph is exactly what Bacon-Rajan's count subtraction is built to tolerate. The
suspicion was reasonable and wrong, and the collector was wrong about something
it owned outright.

### `Promise.all` freed its result array three times

`nts_combinator_new` stored the values array without retaining it — a *move* —
while the compiler passes both arrays as ordinary arguments and releases them
after the call. The combinator's descriptor lists that field, so it released
what it had never acquired, and the array was freed three times: by the caller,
by the combinator, and by the result promise, which retains it at fulfilment.

It read as `Promise.all` answering wrongly, and only when something else
disturbed the allocator — freed memory nobody has reused still holds the right
numbers. Arguments are borrowed everywhere else in the runtime, so the fix is
the retain, and the combinator suite's own calls were relying on the move.

With it fixed, the cycle collector now runs at every **checkpoint**, where both
queues are empty by construction and the program is between jobs. 50,000 async
calls: 14ms holding 44 objects became 9ms holding none — faster, because memory
reused promptly beats memory that grows. The ten-thousand-root threshold stays
for programs that never reach a checkpoint.

I first reported an async call as leaking `awaits + 1` objects under counting.
It does not, and the correction is worth keeping: what accumulates is
**promises**, which are cyclic-capable, so at a count of zero they go to the
cycle collector's candidate buffer rather than being freed on the spot.

A short program ends before the collector's ten-thousand-root threshold, which
is what made it look like a leak. Measured across twenty thousand calls the live
count stays flat, and a forced `nts_collect_cycles()` takes it to zero. The
frames themselves are balanced — 101 allocated and 101 freed over 101 calls —
which is the part this section is about.

`bigint`'s width is the one place this table promises less than the language.
Within it the arithmetic is exact and prints without an exponent, and the one
value it cannot spell is `-(2^127)`: the literal is written as a negation of
`2^127`, whose magnitude does not fit, so it is refused by name.

Three things about it were wrong until a generated sweep asked node. `String()`
of one was refused. A literal above 2^63 emitted its digits, which C has no
literal type for and clang rejects outright. And `1n << 100n` folded to `16`,
because the constant lattice describes *doubles* — a range, whether the value is
whole, whether it could be `-0` — and was still being asked about a value that
is none of those. 100 masked to five bits is 4.
The boundary is deliberate and visible: a literal too large is refused where it
is written. Every `bigint` in the node profile is a 64-bit quantity —
`readBigUInt64BE`, an hrtime timestamp, `0xffffffffffffffffn` — and a true
bignum would put a heap allocation into each of them. What replaces it, when
something needs `2n ** 200n`, is a small-integer fast path beside a heap bignum.

`BigInt(x)` is `Number(x)`'s mirror and not quite its twin. The identity on a
bigint and `0n`/`1n` on a boolean are both what a C cast already is. On a
*number* it is a conversion with a precondition: the specification throws a
`RangeError` when the value is not an integer, so `BigInt(1.5)` is not `1n` and
a cast would be a wrong answer rather than a lossy one. `nts_bigint_from_number`
checks and refuses, the way an index past the end of an array does, and refuses
again above 2^127 " + D + " the same boundary the literals have. From a *string* it is a
parse, which `parseInt` would need too and neither has.

That closed 22 sites reading "a builtin this compiler does not provide", and
**5,875 to 5,821** across the profile: closing it let lowering reach 32 more
things that were behind it.

And what the representation is worth, which the table now carries: the `bigint`
row is **0.99x C++ and 0.09x node**. C++ there is hand-written `__int128`, so
this matches the floor; node's `BigInt` is arbitrary precision and allocates,
and pays eleven times over for a width no `readBigUInt64BE` needs.

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
| control | `Promise` ◐ — the constructor, `all`, `race` | `Iterator`, generator objects | |
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

### `pop` and `at` answered NaN for `undefined`

Both are typed `T | undefined` by the checker, and for a number that is an
erased value with a tag of its own. They returned a `double` instead, with this
written above them:

```c
/* Popping nothing is `undefined`, which for a number is NaN. */
```

It is not. `String([].pop())` is `"undefined"` in node and was `"NaN"` here;
`?? 0` takes the one and not the other; `=== undefined` separates them. The
comment asserted the equivalence rather than checking it, and nothing asked
until the sweep grew a row for an **empty** array — every array cell in it had
three elements, so the case that distinguishes them had never run.

Both now answer from the tag, and the double-returning helpers remain for
callers who narrowed the result back to a number, which costs those nothing.

An `xs.at(i)!` is the one caller that can still be wrong, and it is wrong by its
own assertion: the `!` tells the checker the index is in range, so the payload
is read out directly, and when the index is not in range that read gets whatever
is in the slot. It gets NaN — the same answer the numeric helper gives — rather
than the zero an `undefined` value otherwise carries, so a program that lied
gets one wrong answer instead of two different ones.

### `String()` of an absent pointer handed a null to the concatenation

A `string | null` is one pointer, and `String()` on it returned that pointer
unchanged. For the null that is not text at all: the program aborted on the
first thing that read it.

Which is worth recording for *how* it hid. The differential reports an aborted
case as **declined**, separately from a disagreement, because a program that
stopped has no answer to compare — and "agreed on every case" is printed
alongside. Seventeen declined cases sat under a green line, and only the second
reading of the same output found them. `String(null)` is `"null"` and
`String(undefined)` is `"undefined"`; which one is a property of the type, and
where the type is *nothing but* the absence there is no branch to emit at all.

### A refused initializer was dropped and its readers were compiled

A module-scope declaration whose initializer cannot lower is refused *by
itself*, so that one bad declaration does not darken a whole module's
evaluation. The variable was kept, though, and every function reading it was
emitted — against a global that module evaluation never writes.

```ts
const source: unknown = { a: 1 };
let rendered: string = String(source);   // refused: no conversion from unknown
export function go(n: number): number {
  return rendered.length + n;            // emitted, against a null pointer
}
```

The refusal was printed. The program was produced. And the differential said
`checked 0 of 29 cases` and `agreed on every case`, one line apart.

Both halves are fixed. The declarations whose initializer cannot lower are found
*before* any function is lowered and recorded on the module, so reading one
refuses — asked before the global slot, because such a variable has both a slot
and nothing to put in it. And `agreed()` now requires that something was
checked: a run that reached nothing agreed on nothing. Every case declining is
how a program that stops on all input looks from here.

That second fix found the next one immediately. `examples/map-and-set` had been
*segfaulting on every case* under reference counting while the gate counted it
as passing, because stdout to a pipe is buffered and a crash loses it — zero
lines, no diagnostic, and an agreement over an empty set.

### `map.set` handed back the table it never retained

The crash was `stringKeys` releasing the same `NtsMap` four times: once for the
map and once for each `set`, because `set` returns its receiver so that
`m.set(k, v).size` means something, and returning it hands out a reference the
function never took.

`get` had the mirror of it — the value came out of the slot unchanged, so
reading one key five times released it five times while the table still held it
— and so did both cursor reads a `for...of` uses. All four are the same
sentence: a parameter is borrowed and a call's result is owned.

Every function in that example stored *numbers*, which is why none of it ever
showed. It now has three that store references.

### `fill` and `reverse` handed back a reference they never took

A parameter is borrowed and a call's result is owned. Both work in place and
return their receiver — which is what makes `xs.fill(0).length` mean something
— and neither retained it, so the caller released its own reference *and* the
one it was handed, and the array was freed while still in use.

Invisible under NoGC, which frees nothing, and invisible under reference
counting too until an expression used the array on both sides of the call:
`xs.slice(1)` and `xs.reverse()[0]` in one `return`. Then the live count went
*negative* and the sliced elements read back as whatever had been allocated over
them. Five helpers had it — the three `fill`s and both `reverse`s — and it had
been there as long as they had.

The lesson is about where it was found rather than what it was. `examples/rc`
runs every example under the counting provider and asks whether the program
returns to its baseline; that check has been green throughout, because no
example had ever written the two calls in one expression. A conservation law is
only as good as the programs it is asked about.

### The profile had invalid HIR and no step read the line

`invalid HIR 0` is the *corpus's* number, over single-file cases the suite
generates. It says nothing about the largest body of TypeScript this compiler
sees, and `nts hir` had been printing `the prepared program does NOT verify` for
`path` and `url` with nothing reading it.

The same shape as two things already recorded here: the profile itself existed
as a measurement for months before any gate step emitted it, and `uncompilable
C` was 15 and invisible. A number that counts one thing gets quoted as though it
counted the others.

The gate now verifies every profile module, ratcheted downward like the `rc`
list, and the list is empty. Both were `MissingCallee { callee:
"Closure34#call" }`: `drop_callers_of_refused` removes a closure whose body
calls something refused, and the dispatch that reached it is handled --
reachability nulls a table entry naming a function that is gone -- but
`monomorphize` then wrote that same name into a `Callee::Direct` for a clone,
and nothing looks at a direct call again. A clone exists to turn a dispatch into
a call by name and is only worth making while the name still refers to
something.

Adding that check immediately caught a third module. `util` stopped verifying
when `Boolean(x)` started lowering, on

```ts
Boolean(candidate._readableState || candidate.pipe && candidate.on)
```

— a `||` with an object on one arm and a boolean on another. The join takes the
whole expression's type, so one arm agreed with it and the other was handed over
unchanged, reaching the verifier as `expected: Managed(Object(606)), found:
Bool`. `coerce` had a bare `return Ok(value)` as its last line, which said yes
to everything left. It now refuses a scalar where a reference is wanted and the
reverse; two managed types still pass, because base-first layout makes an upcast
a no-op.

Worth stating plainly: the refusal count *fell from 1,005 to 854* while that was
happening, and 151 of that drop was functions being accepted with invalid HIR
rather than refused. A number that only goes down is not the same as progress.

It then rose to 1,097 when the two modules were fixed, because a module that
does not verify does not finish emitting either, and the refusals past the point
it stopped were never counted. Both movements are the same fact: the reach
number is only meaningful over programs that are valid, and nothing had been
asking whether they were.

### The verifier accepted a multiplication of a tagged value

`nts hir` said "all of it verifies" over

```
%2 = const undefined : erased
%5 = mul %2, %4 : f64
```

which the C backend then emitted as a cast of a struct to a double. The block
was unreachable — the checker had narrowed the operand to `never` — so nothing
would have run wrongly, but nothing would have *compiled* either.

The verifier checked calls, stores, block arguments and dominance, and never an
ordinary operator's operands. It does now, for the one rule with a case behind
it: arithmetic, ordering and the bitwise operators cannot read an erased value.
`Eq` and `Ne` are excluded deliberately — comparing two erased values is what
carrying a tag is *for*.

`invalid HIR 0` had been counting a question nobody asked.

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
  `toString` on a number — which is `String(x)`, and is ECMAScript's
  Number::toString rather than a `printf`: the shortest decimal that reads back
  as the same double. quickjs-ng's `js_dtoa` computes it, an integer takes a
  digit-pair loop written here instead, and the result lands in the frame
  because its length is bounded before the call. Record 0034.

  Absent, and now for want of wiring rather than for want of an algorithm:
  `toFixed`, `toPrecision` and `toExponential` are `js_dtoa`'s `FORMAT_FIXED`
  and `FORMAT_FRAC` with the `EXP_*` flags, and `parseFloat`/`parseInt` are
  `js_atod` — all four already vendored and compiled in, none of them
  reachable from a program yet.
- **`String.prototype`**: `at charAt charCodeAt codePointAt concat endsWith
  includes indexOf isWellFormed lastIndexOf padEnd padStart repeat replace
  replaceAll slice split startsWith substring toString toWellFormed trim
  trimEnd trimStart valueOf length`, and the statics `fromCharCode` and
  `fromCodePoint`. This list said `at`, `split`, `replace` and `trim` were
  absent long after they were not.

  `toLowerCase` and `toUpperCase` are there because the tables are:
  quickjs-ng's `libunicode` is vendored under `runtime/c/quickjs`, MIT, and
  emitted only
  for a program that calls one of them — linking it always would take
  `examples/hello` from 81 KB to 162 KB. That closed 39 refusal sites in the
  node profile. Record 0033.

  Absent, and each for its own reason rather than for want of writing it:
  `normalize` has its tables now and is not yet wired (3 sites); the `toLocale`
  pair is deliberately **not** aliased onto the plain forms, because
  `toLocaleUpperCase` of `i` in Turkish is `\u0130` and answering it with the
  locale-independent mapping would be wrong rather than approximate;
  `localeCompare` wants ICU; `match`, `matchAll`, `search` and the *pattern*
  forms of `replace` and `split` want a regular expression engine, which is
  refused as its own feature; `String.raw` waits on tagged templates. Indexing
  (`s[0]`) is refused as "indexing a representable type, which is not an
  array".

  `isWellFormed` and `toWellFormed` are ES2024, and this paragraph said for one
  commit that they were written, could not be reached, and were taken out again
  because the fixtures were pinned to ES2022. That was true of the fixtures and
  is what got the target changed: the programs are ESNext now and both are back,
  in the differential. A target is not a detail of the build — it decides which
  language the compiler is a compiler for.
- **`Array.prototype`**: `at every fill filter find findIndex forEach includes
  concat indexOf lastIndexOf map pop push reduce reverse shift slice some
  splice unshift length` on an array of numbers, and `at concat every filter
  find findIndex forEach includes indexOf map pop push reduce reverse shift
  slice some splice unshift length` — plus `join` — on an array of
  *references*. `push` and
  `unshift` take as many elements as they are given; `splice` takes two
  arguments, and the insert form is a different signature rather than a longer
  one, and `concat` takes one array. Absent: `sort`, `flat`, `flatMap`,
  `findLast`, `findLastIndex`, `reduceRight`, `toSorted`, `toReversed`, and
  everything on an array of booleans.

  `concat` in JavaScript takes any number of arguments and *spreads* the ones
  that are arrays while appending the ones that are not — two questions the
  checker can answer and a runtime helper cannot. One array argument is the
  shape worth a helper; the rest is refused by name rather than answered
  wrongly.

  `some`, `every`, `findIndex`, `find` and `filter` are compiled as the loops
  they are, like `forEach`, `map` and `reduce` before them: the callback inlined,
  no closure allocated, no indirect call. The first four stop early, which is one
  mechanism they share; `filter` allocates once, as long as its input, and is
  shortened to what it kept.

  What is absent is absent by *count*. `shift`, `unshift` and `splice` are here
  because `runtime/node` uses them seventeen, sixteen and twelve times; `flat`,
  `flatMap`, `findLast`, `findLastIndex`, `reduceRight` and `toReversed` are
  not, because it uses them zero times between them.

  Every one of those twelve `splice` calls throws its result away, and this
  still allocates the removed run for them. A `_void` form chosen where the
  result is dead is the fix, and it is a question about the caller.

  The 22 profile sites that wanted a method on a non-numeric array all wanted a
  reference element — strings, objects, closures, an `Int32Array` — and not one
  wanted booleans, so there is no `_bool` family. Three questions change with
  the element and nothing else does: `pop` and `at` answer `T | undefined`,
  which for a reference *is* the null pointer and needs no tag; `indexOf`
  compares by `===`, which on a string is value equality, so
  `["a"].indexOf("a")` is 0 across two separately built strings and a pointer
  comparison would answer -1; and every element crossing the boundary is a
  reference count.
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
| ✅ | strict equality on numbers and strings |
| ✅ | relational comparison — `<` `<=` `>` `>=` — on numbers, and on strings by UTF-16 **code unit** | not `strcmp` and not `memcmp`: a narrow and a wide string compare a byte against a code unit, and above the BMP code-unit order disagrees with code-point order — `"\u{1F600}" < "\uFFFD"` is true because the leading surrogate is 0xD83D. This row read ✅ while both backends compared **addresses**; the sweep had no cell for a relational operator, and now has one |
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
| ✅ | array and object destructuring, including nested and renamed — in a declaration **and in the head**: `for (const { from: { x }, weight } of segments)` binds by property off the element, where `[key, value]` over a table stays positional because those two names take two reads and no pair is ever built |
| ✅ | mutation during a walk: an entry appended is visited, one deleted ahead is not |
| ✅ | `[Symbol.iterator]()`, `.next()`, `{ value, done }` — the object itself, where the result type is written out | the fourth walk and the only one with no cursor: `next()` both advances the iterator and produces the element, so one call answers "again?" in the header and "with what?" in the body, which the header dominates. The header is the latch, because `continue` has to reach the step |
| ✗ | `IteratorResult<T>` from `lib.d.ts` | a union of two object types whose `value` is `T` in one and `any` in the other, so they lay out differently and the union has no representation. A hand-written `{ value: T; done: boolean }` works; the standard spelling is refused and named |
| ✗ | iterator **closing** (`.return()` on abrupt completion) | a correctness detail, not a convenience, and generators are what made it observable: a `for...of` left by `break` calls `gen.return()`, which resumes the generator inside its `try` so the `finally` runs. A generator whose `finally` incremented a counter disagreed with node on **26 of 29 cases**, so a `finally` spanning a `yield` is refused by name. A `catch` spanning one is not, and that is measured: 29 of 29 agree |
| ✅ | `for...of` over a user type with `[Symbol.iterator]` | `break` and `continue` both correct, nested walks independent, the iterator built once per loop. Allocates **nothing**: the result object is one frame slot reused, because each dies before the next is made — `tooling/memory/cases/iterator-protocol` argues it |
| ✅ | `for...of` over a **generator** | the fifth walk and the second with no cursor. One call to the resumption and one field read an element; **nothing allocated per element and no `{ value, done }` at all**, so a walk of any length allocates once. 1.07x hand-written C++, 0.05x node |
| ◐ | spread over an iterable; `new Map([[k, v]])`. `Array.from(xs)` where `xs` is already an array is a copy and works; a mapper, or anything iterable that is not an array, does not |
| ✅ | `Map`/`Set` `forEach` | the `for...of` table walk with the callback's body inlined — `walk_cursor`, `walk_condition`, `read_element`, `Step::Walk`. `(value, key)`, which is the reverse of the order the table stores them in; a `Set` passes its element twice |
| ✗ | the **table** parameter of a `Map`/`Set` `forEach` | the third the callback may take. Handing the receiver to the body lets it be stored where the loop cannot see, and mutating a table during a walk changes what the cursor is walking |
| ✅ | a default in a destructuring pattern (`{ a = 1 }`) |
| ✗ | `yield*` | delegates to another iterable, so one `next` on the outer generator is an unbounded number of steps on the inner one — a nested cursor in the frame rather than a state number, and the nesting has no fixed depth |
| ✗ | the **value** of a `yield` (`const v = yield x`) | what the caller passed to `next(v)`, and a `for...of` passes nothing. Answering `undefined` to a program expecting a two-way conversation runs and produces numbers, which is why this is refused rather than approximated |
| ✗ | a generator walked anywhere but where it was made | the resumption does not exist when the loop is lowered, so the loop names it from the call that produced the frame. Refused a step earlier, at the parameter: `Generator<T, ...>` has no representation, so a signature cannot name one |
| ✗ | `async function*`, the async iterator protocol, `for await...of` | the two protocols disagree about what a resumption is *for*: one settles a promise nobody is waiting in front of, the other answers a caller who is. Refused by name rather than by whichever check fired first |
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
| ✅ | abrupt completion through `finally`, including one that replaces the completion leaving it |
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
| ✅ | a hash table — open addressing, linear probing, tombstones, power-of-two slots; `Map` and `Set` are built on it, and `Object`'s enumeration statics turned out not to need one |
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
| examples | the compiled program agrees with node, case by case | 90 of 90 |
| sweep | a generated cross-product agrees with node, cell by cell | 9,570 cases across 330 functions |
| corpus | arbitrary input produces no invalid IR and no C that will not compile | 49 lower cleanly; `invalid HIR` 0, `uncompilable C` 0 — both hard rows |
| profile | how much of a real standard library lowers | 22 modules emit and verify; 1,097 distinct refusal sites |
| rc | the same examples hold nothing at exit under reference counting | 87 of 90, three named |

Only the examples and the sweep check **correctness**, and they check it
differently: an example covers what somebody thought to write down, a sweep
covers what nobody did. Every correctness bug found here by hand has been one
cell of a product — `null === undefined` answered true, `typeof f ===
"function"` answered false, a `bigint` `&` narrowed both operands to 32 bits —
which is the whole argument for generating them.

A sweep is only as good as its dimensions, and one of them was missing until a
wrong answer got through: every value was produced as an *expression*, and an
expression has the most concrete representation its type allows. The same
TypeScript type reaching a **parameter** can be represented differently, and
that is where `typeof` on a declared signature answered `"object"`. Each cell
now runs both ways.

The two measure different things, and a stretch of work can move one and not the
other. Four wrong answers were found and fixed in a run that took the profile
from 1,013 sites to 1,012: `typeof` on a declared signature, `pop` and `at`
answering NaN for `undefined`, `String()` handing a null pointer to a
concatenation, and a verifier that accepted a multiplication of a tagged value.
None of them was a refusal, so the reach number could not see any of them.

The corpus checks robustness; the profile measures reach and runs nothing, so a
function counted there is one that compiles rather than one known to be right —
and until recently it counted functions that could not even be emitted, because
the row that would have said so was collected and never printed.

Two ways the profile number has since been caught lying, both worth remembering
before quoting it:

- It once counted functions the verifier had never seen. `nts hir` verifies the
  **pruned** program, and an addon emits every *export* — so an exported
  function nothing calls was dropped before the check and compiled anyway. That
  is how `void FSWatcher__ref(...)` came to return a pointer.
- It went **down** by 26 once, and that was the fix: a return type with no
  representation used to default to `void`, so those functions were being
  counted as lowered while emitting C that does not compile.

`uncompilable C` had the same shape of problem. The emitter *silently dropped* a
struct field whose C type it could not compute, while the descriptor beside it
kept taking an `offsetof` into it — a struct missing a field the reference map
still points at is not a smaller object, it is a wrong one.

It is fixed now, and neither horn of the dilemma the note described was
necessary. Every managed object is one pointer whatever its layout; the
reference map wants an offset and a pointer has one; and nothing can dereference
such a field, because reading through it would have called `layout_of` and there
would be a layout. So it is emitted **opaque** -- which is also where LLVM
already is, having had none but opaque pointers since 17.

93 across the node profile, not the five this section used to claim, and it is
3: the three that remain are `layout_of` failing where a function genuinely
reads through the type, with a source location. **`uncompilable C` is 0** and is
a hard row now, as its note always said it would become when it got there.

Before it was fixed it was named, and that alone is worth recording. Nor are they obscure: a cell's `value`, a closure's
captured `callback`, `Agent.requests`. Naming them cost nothing — 90 of 90
examples still agree.

What it did surface is that `uncompilable C` was two different things in one
number. The check returned a single error for "the backend declined" and "clang
rejected what we wrote", so a *named refusal* was counted as malformed output.
Those are not the same failure: the first emitted nothing and said why, which is
what every refusal does. They are separate now — `uncompilable C` stays at 2 and
means clang, and a backend refusal is reported as one. A number is only worth
ratcheting if everything in it is the thing the number is named after, which is
the same lesson the `rc` list taught two sections up.

### The compiler computes its own offsets now, and clang checks them

Descriptors were built with `offsetof`, on the principle that the compiler which
laid the struct out is the one that says where its fields are. That is exactly
right while C owns the layout, and it stops being available the moment anything
else does: a second backend emits its own aggregates and has no `offsetof` to
ask.

So the placement moved into `nts_codegen_common::layout` — the platform C ABI's
rule for a struct, which SysV and AAPCS64 agree on for everything here: a field
starts at the next offset that is a multiple of its alignment, the struct's
alignment is the widest field's, and its size is rounded up to that. Every
managed value is one pointer, which is what lets a field whose type has no
layout be placed exactly without one; `NtsValue` is two words; a `bigint` is the
only thing here wider than a word, and it drags the whole object's alignment to
sixteen.

The C backend keeps `offsetof` for one purpose: to **check** this, on every
build, with a `_Static_assert` per field and one for the struct's size. The
claim and the oracle side by side. Across the node profile that is **10,340
assertions, and clang agrees with all of them** — so the number that matters
here is not that the engine works but that a disagreement would stop the build
with the field's name in the message.

They stay side by side until the claim has gone long enough without being wrong
to become the authority. The C backend has no reason to stop using `offsetof`;
the one that comes next has no way to start.

## 15. What to do next, ordered by evidence

### First, by whether anything can check it

The queue splits on a line that has nothing to do with difficulty: **node 24
strips types, it does not transform them**, so it refuses to *run* a file
containing a construct that has to be emitted rather than erased.
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, before a single test executes.

- **`enum`, `const enum`, and `namespace` with code — no oracle.** Node will not
  run the file at all. The differential, which this project calls its oracle,
  has nothing to compare against, so building these means shipping constructs
  only the corpus sees. About 10 of the queue. That is a decision about tooling
  -- transform with tsgo before handing the file to node -- and not about the
  lowering.
- **Everything else — checkable today.** `console.log`, a `Date` property, a
  rest parameter, a tagged template, `for...in`, `for...of` destructuring, a
  method on an object literal: node runs all of them, verified together in one
  file. About 28 of the queue.

Build the second group first. Not because it is easier, but because a refusal
replaced by an unverified answer is the trade this file exists to refuse.

### Then, by what real code needs


From the node profile's refusal sites — 1,097 of them, counted **once each**.
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
| closures and function values | **done**, all four rows. 101 sites, and the profile went 1,155 → 1,041 across the four changes | a function as a value, capture by reference, module-scope names, and a capture above its own declaration. What is refused is one thing: a `for` loop's own variable, which JavaScript rebinds per iteration |
| module evaluation | 81 — one refusal repeated across the top level of nearly every module | a statement at module scope that is not a declaration; the evaluation order is already modelled |
| a class as a value | 68 — the largest single row | a class object with a descriptor, which `instanceof` and the ambient `lib` classes both wait on |
| a member a type does not declare | 62 — 26 of them on an anonymous type, then `StreamLike` (12) | mostly structural types the decomposition stopped at; count before building |
| a global member | 64 — a long tail: `Object.defineProperty` 14, `Array.from` 10, `ArrayBuffer.isView` 7 | the largest entry is §13's, so this row is smaller than it looks |
| `instanceof` | 67, but **8** are `instanceof` — 59 are one idiom, `override get ["constructor"]() { return TypeError; }` | blocked twice over: two classes of a shape share a descriptor (§4), and every right-hand side in all 67 is an ambient `lib` class this compiler does not declare |
| the async iterator protocol | 63, all `AsyncIterableIterator` — and a **second** 62-site row is the same thing under another message, a property `#lineObjectStream` of type `AsyncIterableIterator \| undefined`. One property, counted 62 times | §10 plus the suspension machine, which `async` already has |
| `symbol` | 46 — `string \| symbol` as a property key, 30 as a parameter and 16 as a property | a representation, and a decision about whether well-known symbols are values or names |
| a method not in the hierarchy | 52 — `emit` 8, then a long tail | structural dispatch, which is the same question as the anonymous-type row above |
| ~~array methods on a non-numeric array~~ | **done**, 22 → 4 → 1. Every site wanted a *reference* element, so there is a `_ref` family and no `_bool` one; `shift` and `splice` have since landed for both | what is left is `toSorted`, one site |
| string methods | 3 — `normalize`. `toLowerCase` and `toUpperCase` are done, which was 39 sites; `split`, `trim`, `replace`, `replaceAll`, `padStart`, `padEnd` and `valueOf` before them | the case tables are vendored and `normalize`'s came with them; it wants `dbuf` and an allocator argument |
| generators | 4 refusals, but `readline` and several streams are behind them | the suspension machine exists; what is missing is the `Generator<T>` object and §10's protocol |
| ~~`try`/`catch`/`finally`~~ | **done**. A handler is a block and a `throw` is a jump to it, carrying the thrown value as a block argument — so there is no unwinder, no landing pad and no table, and a `throw` caught in the same function allocates nothing | what is left is a `throw` that crosses a *call*, which is where 0070's pending slot belongs; 0071 has the shape |

Two rows in the corpus are meant to be zero, and both are: `invalid HIR` and
`uncompilable C`. Neither is ratcheted any more.

### What came off this list

`typeof` (25) and absent literals (33 → 16) came off together, and neither was
the shape its message suggested. `typeof` was not waiting on a tag: every
answer it refused was fixed by the representation, or by one branch on a
pointer that carries a single absence. The absent-literal row was not waiting
on a representation either — half of it was `x == null` on a type with no
absence, which is a constant the equality algorithm reaches before it converts
anything, and the other half was `callback(null, …)`, which was refused because
an argument's `parent` link points at a list node and the rule that reads
argument positions had never once matched.

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

## 16. What the checker knew, and the IR dropped

§6 says types are erased: they decide representation and then stop existing.
That is the design, and it is why nearly all of the type surface costs nothing.
But erasure runs in one direction only, and it takes the proofs with it. By the
time a backend could use the fact that a value is one of three integers, nothing
in HIR remembers that anybody ever knew.

This section is the ledger of those facts. Ordered by what was measured, and
the zeros are kept — three of the entries below are things that looked obvious
and were worth nothing, which is the only reason to write them down.

The question to ask of every new pass: **what did the checker know that we
dropped?**

### Two kinds of fact, and only one of them is cheap

**Stated.** TypeScript, or the runtime header, already says it. Recovering it
is carriage, not analysis: find where the fact is discarded and stop discarding
it. Both of this week's wins were this shape, and both were small changes.

**Derived.** Nothing states it and an analysis has to prove it. That `Ball.x`
fits an `int32` is true and no part of the program says so — §7's note on the
awfy family is this shape, and it is still open.

The distinction is the whole planning value of this section. The first kind is
bounded work with a known answer. The second is a research problem, and filing
the two together turns a short list into a long one.

### What it was worth

| fact | where it was being dropped | measured |
|---|---|---|
| a length is a `uint32_t` | the header states it; `OpKind::Length` was typed `f64`, so a counter bounded by one was not provably an `i32` | **4.0×**. `elementwise` went 4.95× C++ to 1.25×, and it moved `accumulate`, `awfy-nbody` and `awfy-sieve` with it. Both backends |
| a typed-array element is a `u8` | the element type was known and the value still travelled through a `double` on the way to an `i32` | the generated C went from **74 implicit conversions to 0**; `simplify::fold_conversions` collapses the detour where it is exact |
| `readonly` on a field | `Field::readonly` is carried all the way from the frontend | **0**, twice over. `!invariant.load` is the wrong encoding — it licenses "same value wherever the location is dereferenceable", which folds a post-construction load into a pre-construction one. And no benchmark has a `readonly` field, so there is nothing to measure even if the encoding were right |
| an array that cannot grow | `arrays_can_grow` is **one boolean for the whole program**: a single `push` anywhere disables exact-length reasoning everywhere | **0**, and not for the reason expected. Adding an unrelated exported `push` to `elementwise` changed `scale`'s IR *not at all* — its array is a parameter, and `allocated_length_is_exact` already declines for parameters. The cliff is real and no case has yet fallen off it |

Two more zeros belong here for the same reason, from §7's attribute work:
`captures(none)` was worth nothing once `memory(read)` was in place, and the
allocator attributes (`malloc`, `returns_nonnull`) were worth nothing at all.

### What is still on the table

Each row is a fact TypeScript states today and HIR does not carry. None of them
is measured, so none is a promise — the `readonly` row above is what an obvious
one is worth when nothing exercises it. **Build the case that would show it
before building the pass.**

| what TypeScript states | what it would license | what would falsify it |
|---|---|---|
| **definite assignment** — `strictPropertyInitialization` proves every field is written before it is read | `hir::fields` joins in `Facts::constant(0.0)` "because that is what the allocator leaves", and its own comment says avoiding it needs a definite-assignment analysis. The checker has already done that analysis | soundness first: `!` assertions and a non-strict config both opt out, so it is conditional on a flag we would have to read. Then a case where the join is what widens a field |
| ~~**literal and union-of-literal types**~~ — **audited, and half of it is already done.** The *range* reaches the backend: an exported `f(d: 0 \| 1 \| 2 \| 3)` indexing a four-element array emits `array.get unchecked`, where the same function taking `number` emits a checked one. Same shape, same array, one difference — so the check is removed by the declared type and nothing else. What is **not** used is the *representation*: that parameter is still `param 0 : f64`, a double holding one of four small integers | the remaining half is a narrower parameter, and it is not free — a public signature is an ABI, so `number` being `f64` is a promise to the next caller. It is available to a *non-exported* function, where the whole call graph is visible |
| ~~**an exhaustive discriminated union**~~ — **audited: blocked at the lowering.** `switch (s.kind)` over `{kind:"circle";r} \| {kind:"square";side}` is refused outright: "`kind` on a union, whose members lay their fields out differently". There is no default arm to remove because there is no switch | Lane 1 first, exactly as `instanceof` was. Price the fact after the construct compiles |
| ~~**`as const`**~~ — **audited: worth nothing today.** `[10,20,30,40] as const` and the same array without it emit identical HIR — two checked `array.get` and two `array.len` apiece. Deep readonly and the fixed length are both discarded | — |
| ~~**a counted loop over a *global* array keeps its bounds checks**~~ — **found by the control above rather than looked for, and fixed.** Each mention of a module-level `A` is its own `global.get`, so `A.length` bounded `%7` while `A[i]` indexed `%12` and the relationship never matched. Two loads of one global are two values and one array; `same_array` says so while nothing writes that global. Both accesses are `array.get unchecked` now | **its worth is unmeasured, and that is this section's own warning pointed at itself.** No benchmark has a module-level array -- zero of them -- so the check is gone and nothing prices it. `examples/module-state` does have one, so it is *correct* (91 of 91 agree with node); it is not *measured*. A lookup table at module scope is a common real shape and the case is worth adding |
| **`enum`** — a member is one of N known constants | the same range fact as literal types, on a construct real code actually uses | §6 marks `enum` ✅ but the corpus refuses four of them. This is Lane 1 work before it is Lane 2 work |
| ~~**non-nullability**~~ — **audited: already done.** A function reading `b.value` through a `Box` emits **zero** null tests; the same read through a `Box \| null` emits four. The type removes it outright, so there is no check left for a `!nonnull` to help | nothing. Kept as a row because the next person to look at this list should not spend an afternoon confirming it |
| **`readonly T[]` per array** | the per-array answer to `arrays_can_grow`'s whole-program boolean | the row above: find the case that falls off the cliff first |

### `instanceof` is where the two lanes meet

`erasure.rs` reads `INSTANCEOF_KEYWORD` to recognise that `x instanceof C`
narrows an erased value — a real precision gain, on the compiler's single
largest representation cost. The constant was **wrong**: 104, which is `new`;
`instanceof` is 103. Every classification it made was of the wrong keyword.

Fixing it changed no measurement, and the reason is the useful part. There is
no example that uses `instanceof`, because `instanceof` on a class is refused
before the erasure analysis ever runs — "a class used as a value is not
supported by this lowering yet", §15's largest single row at 68 sites.

So a silent precision loss sat behind a refusal, where no test could reach it
and no benchmark could price it. That is the general hazard with this section:
**a Lane 2 fact is worth zero until the Lane 1 construct that produces it
lowers.** Check that a construct compiles before pricing what its type could
buy.

### The one that is not stated, and what it is actually made of

This entry was written twice. The first version said `awfy-bounce`'s 1.53× was
`Ball` carrying four `number` fields that hold `int32` values, gave a
flow-sensitive fixpoint that would prove it, and was wrong about the cause. It
is kept here as written and then corrected, because the correction is the more
useful half.

The claim was testable without writing the analysis: state the conclusion in
the source and measure. A throwaway copy of `bounce.ts` with every field store
written through `| 0` makes `hir::fields` narrow all four to `i32` — checked in
the HIR, and the runner's checksum confirmed the program was unchanged. It is
not checked in: `| 0` is not what a TypeScript programmer writes, and a
diagnostic that lives in the benchmark directory eventually gets read as one of
the benchmarks.

| | nts (C) | vs C++ |
|---|---:|---:|
| `awfy-bounce`, fields `f64` | 6.37 us | 1.55× |
| `awfy-bounce-int`, fields `i32` | 5.92 us | 1.43× |

**7%.** Real, and not the gap. So the reference was worth reading rather than
summarising: C++ `Ball` is four `int32_t` — 16 bytes, not the 40 first claimed
here — and the hundred of them are a `std::array<Ball, 100>` **inline on the
stack**. nts allocates a hundred separate objects, each behind a 24-byte
header, reached through an array of pointers.

Compiling the reference four ways separates the two costs:

| | | |
|---|---:|---|
| inline `int32`, as the reference is written | 5.75 us | |
| inline `double` | 6.46 us | the field width costs **1.12×** |
| boxed `int32` | 8.77 us | the boxing costs **1.52×** |
| boxed `double` | 10.81 us | together, 1.88× |

Boxing is the cause and field width is a rounding error beside it. The numbers
reconcile: scaled into this harness nts sits at about 8.9us, which is *boxed
int32* almost exactly — the bump allocator already lays the hundred objects
down contiguously, so what is left is the header spacing them apart and the
pointer array reaching them.

**What that makes the work.** Not a range fixpoint. An array whose element type
is a class, whose objects never escape the function that fills it, and which is
never assigned an element from elsewhere, can hold the *fields* contiguously
rather than a hundred pointers to a hundred headers. `hir::escape` already
computes the escape half; the element type is exactly what `Ball[]` states.
This is the same shape as every other entry in this section — a fact the
checker states, dropped on the way to a layout — and it is worth more than
every field-narrowing entry above it put together.

Two lessons, both paid for. **Read the reference, do not summarise it**: the
40-byte figure was invented and the `std::array` was the whole answer, sitting
in a header nobody had opened. And **price a fix by stating its conclusion in
the source before building the analysis that would derive it** — `| 0` cost one
file and refuted a week of work.

### What a representation costs when no analysis can remove it

`fib` is the row where this section runs out. It sits at **1.70×** C++, the
second-widest gap in the table, and none of it is a dropped fact.

`fib#whole(n: i32)` already exists — the *parameter* narrows, because `number`
carrying a whole value is exactly what the `#whole` specialization proves. The
**return** is still `f64`, so every base case emits a `convert %0 : f64` and the
combine is a double add where the C++ reference has an integer one.

Compiling the reference twice — once as written, once in nts's representation —
prices that exactly:

| | `fib(27)` | vs the reference |
|---|---:|---:|
| C++ `int64_t` throughout, as the reference is written | 301.96 us | 1.00× |
| C++ with an `int32_t` parameter and a `double` result | 485.93 us | **1.61×** |
| nts (LLVM) | 517.40 us | 1.71× |

So **1.61× of the 1.70× is the representation**, and 6.5% is everything this
compiler does differently from clang given the same one. There is no analysis
to write: narrowing the *return* needs `fib(n) < 2^31`, which needs a bound on
`n`, which the exported signature destroys — and the reference's `volatile`
denies clang the same bound, so this is not a constant-folding advantage either.

Worth keeping as the section's own ceiling. Three of the four zeros above were
facts that turned out not to be there; this is a gap that is real, measured, and
still not a fact anybody dropped.
