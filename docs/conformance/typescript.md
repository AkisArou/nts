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
| ✅ | comparison, equality | `< > <= >= === !==`, and `==`/`!=` where nothing coerces |
| ◐ | `==` that **coerces** | refused — see below |
| ✅ | logical | `&& \|\| !` |
| ✗ | `in` | needs a decision about an optional property, whose slot exists here and not in JavaScript |
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
| ✗ | `??=`, `\|\|=`, `&&=` | |
| ✅ | `?.` | one link; a chain after an optional access is refused and named |
| ✗ | `?.()`, `?.[]` | optional call and optional index |
| ✗ | spread | `[...a]`, `{...o}` |
| ✗ | `delete`, `void`, comma | `in` is named above |
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
| ✅ | `async`/`await` — under both providers |
| ✅ | type predicates (`x is T`) and `asserts x is T` |
| ✅ | rest parameters | the call gathers its trailing arguments into the array |
| ✗ | `function` expressions — an arrow with the same body lowers |
| ✅ | closures over a variable something **assigns to** — the variable moves into a cell |
| ✗ | a closure over a `for` loop's own variable, which JavaScript rebinds per iteration |
| ✅ | a closure written *above* the declaration of a local it reads |
| ✗ | generators (`function*`, `yield`) — needs the `Generator<T>` object |

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
are refusals at the *read* that say what the thing is: a module-scope variable
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
window would read a zero where JavaScript throws a `ReferenceError`. Nothing
here throws — `nts_thrown` prints and aborts — so such a cell carries a `ready`
flag and stops the program instead:

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
| ✗ | parameter properties (`constructor(public x: number)`) |
| ✗ | `abstract` **methods** — the class works, the declaration is refused |
| ✗ | generic classes |
| ✗ | a class used as a *value* (`C` itself, `instanceof C`) |
| ✗ | methods and getters on **object literals** |
| ✅ | a member keyed by a **symbol** (`[kRefed]`) — an ordinary field, not a map |
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
| ✅ | `typeof` — including `"function"` for a closure and `"object"` for `null` |
| ✅ | `Map`, `Set` — one insertion-ordered table, keys and values as tagged values |
| ✅ | the polymorphic `this` — the receiver's own pointer, which costs nothing |
| ◐ | `bigint` — exact, and **128 bits** rather than arbitrary precision; `String()` in decimal |
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

A gap this opened, still real:

- `v?.length` directly on a two-absence union is refused — the receiver is
  erased and the present branch does not unerase it. Narrowing first works, in
  all three forms: `v !== null && v !== undefined`, `typeof v === "string"`, and
  plain truthiness.

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
  `toString` on a number. Absent: `toFixed`, `toPrecision`, `parseFloat`,
  `parseInt`.
- **`String.prototype`**: `charAt charCodeAt codePointAt concat endsWith
  includes indexOf lastIndexOf repeat slice startsWith substring length`.
  Absent: `at`, `split`, `replace`, `trim`, `padStart`/`padEnd`, case
  conversion, `match`, and indexing (`s[0]`).
- **`Array.prototype`**: `at fill forEach includes indexOf lastIndexOf map pop
  push reduce reverse slice length` on an array of numbers, and `at includes
  indexOf pop push reverse slice length` — plus `join` — on an array of
  *references*. `push` takes as many elements as it is given. Absent: `concat`,
  `filter`, `find`, `sort`, `shift`, `unshift`, `splice`, `some`, `every`,
  `flat`, and everything on an array of booleans.

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
| examples | the compiled program agrees with node, case by case | 90 of 90 |
| sweep | a generated cross-product agrees with node, cell by cell | 9,570 cases across 330 functions |
| corpus | arbitrary input produces no invalid IR and no C that will not compile | 49 lower cleanly; `invalid HIR` 0, `uncompilable C` 2 |
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

`uncompilable C` has the same shape of problem and still does. It is ratcheted
at 2, and 2 is not the true count: the emitter *silently drops* a struct field
whose C type it cannot compute, while the descriptor beside it keeps taking an
`offsetof` into it. Making that a diagnostic reads **5**, all saying `an object
type with no layout`. The honest repair — every object-typed field must have a
layout — costs 40 profile functions, which is why it is written down here
rather than done quietly under a feature.

## 15. What to do next, ordered by evidence

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
| ~~array methods on a non-numeric array~~ | **done**, 22 → 4. Every site wanted a *reference* element, so there is a `_ref` family and no `_bool` one | what is left is four single-site methods that do not exist for any element type: `shift`, `splice`, `toSorted`, and one unnamed |
| string methods | 15 — `toLowerCase` 12, `normalize` 2, `toUpperCase` 1. `split`, `trim`, `replace` and `replaceAll` are done | what is left wants a Unicode case table and normalization, which is a different order of work from the rest |
| generators | 4 refusals, but `readline` and several streams are behind them | the suspension machine exists; what is missing is the `Generator<T>` object and §10's protocol |
| `try`/`catch` | the largest *language* gap, and invisible in this table because the code that needs it does not reach the lowering | needs an unwinding decision — the runtime has none |

Two rows in the corpus are meant to be zero. `invalid HIR` is 0. `uncompilable
C` is ratcheted at 2 and only downward — see §14 for why 2 is not the true
number and what the honest count costs.

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
