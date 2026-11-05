# Boundaries

What nts does not compile, and why. A boundary is a decision: the construct is
out of scope on principle, and it is in no backlog. There are three: code made
from text while the program runs, changing an existing object's prototype, and
sloppy mode. A gap is different: it is
refused today and wanted, and the [feature table](README.md) lists it. This
page is for anyone writing a program for nts, and for whoever decides whether a
test is in scope. The conformance tools cite its sections as the authority for
what they leave out of a count.

## How a boundary is used

- **When a program reaches one,** nts refuses it by name at compile time,
  unless a section below states the answer nts gives instead.
- **In a count,** a test262 case under a boundary leaves the in-scope
  denominator, through `tooling/census/features.json` (the class
  `inapplicable`) or `tooling/census/test262-exclusions.json`. Each entry cites
  a section of this page. The case is still compiled and run, and one that
  starts passing is reported ([test262](../conformance/test262.md#how-a-case-is-counted)).
  In node's tests, a `not-applicable` entry whose reason begins
  `language non-goal` must rest on a boundary here
  ([node](../conformance/node.md#how-a-file-and-a-module-are-counted)).
- **In a test,** an assertion may pin a divergence from node or test262 that
  this page declares. It never pins one the implementation merely happens to
  produce: that would hold a defect in place, and fixing it would fail the
  test.
- **Changing one** is the user's decision ([Decisions](#decisions)).

## The object model

Most of what nts refuses today follows from how an object is represented. Each
type has one layout, fixed at compile time: a header, then the fields at
offsets the compiler chose. In the native runtime the header holds the type's
descriptor, a word the memory provider owns, flags and a length. The
descriptor holds the size, which offsets hold references, the method table and
the type's name. The JVM keeps the same model as one class per type, and
Wasm's design as one struct per type.

There is no prototype pointer and no property map, so reading a property of a
known type is a load at a known offset. That layout is the default, not a
limit. A feature that needs more, such as a property redefined while the
program runs, is to get a representation that holds it only in the values the
compiler proves use it; every other value keeps the fixed layout
([in scope, not yet built](#in-scope-not-yet-built)).

## Dynamic code

Code made from text while the program runs is JavaScript that exists only
then:

- `eval`, direct or indirect;
- the `Function`, `GeneratorFunction`, `AsyncFunction` and
  `AsyncGeneratorFunction` constructors given source text, with or without
  `new`;
- a timer given a string of code instead of a function.

A compiled program carries no parser, interpreter or JIT, and nts never adds
one because a program reaches these. `eval` is refused as NTS1101, "never
provided", and the `Function` constructor as a builtin nts does not provide
(NTS1100).

This is a permanent boundary ([Decisions](#decisions)). Source the compiler
proves constant may be compiled ahead of time later, as an optimization, as a
[design note](../records/notebooks/eval.md) shows. test262's `eval` and
`Function` cases leave the in-scope denominator; `test262-exclusions.json`
does not exclude them yet.

## Changing a prototype

An object's prototype is fixed when the object is made. `Object.setPrototypeOf`,
`Reflect.setPrototypeOf` and an assignment to `__proto__` change it
afterwards, under a live object, and nts refuses them. Every method call and
inherited read on that object would otherwise depend on a link that can move
while the program runs, and the compiler could no longer decide them from the
object's type.

Reading a prototype with `Object.getPrototypeOf`, and choosing one when an
object is made, with `Object.create` given a prototype object or `__proto__`
in an object literal, are not boundaries: they are in scope
([below](#in-scope-not-yet-built)).

## Sloppy mode

Every TypeScript source is strict mode code: the checker parses each file as
strict, whether or not it is a module. So what only sloppy mode allows, such
as `with`, legacy octal literals and octal escapes, is an error before nts
lowers anything, and what only sloppy mode means (`this` as the global object
in a plain call, an assignment that creates a global) never arises. A
function's legacy `caller` property is a sloppy-mode extension and is not
provided. `Symbol.unscopables` changes only how a name is looked up inside
`with`, so in a strict program it has nothing to act on.

In test262, `noStrict` and `raw` files are scope-excluded: counted, and not
attempted ([test262](../conformance/test262.md#scope-at-the-pin)). Every
`caller` case is a `noStrict` file, and `features.json` classes the
`Symbol.unscopables` feature with this section. A JavaScript dependency written for sloppy
mode is not compiled either, and a CommonJS dependency comes in through an
interop layer ([modules](modules.md#commonjs)).

## Annex B

Annex B of ECMA-262 holds legacy web features, in two halves, and only one of
them is a boundary.

- **Its syntax and semantics for sloppy mode** go with sloppy mode:
  block-level function hoisting for web compatibility, labelled function
  declarations, function declarations as `if` clauses, and initializers in
  `for-in` heads. `[[IsHTMLDDA]]`, the slot behind `document.all`, belongs
  to a host object nts never has. Assigning its `__proto__` accessor goes with
  [changing a prototype](#changing-a-prototype); reading it, and `__proto__`
  in an object literal, are in scope ([below](#in-scope-not-yet-built)).
- **Its library half is not a boundary.** `escape`, `unescape`,
  `String.prototype.substr`, the HTML methods (`anchor`, `bold` and the rest),
  `trimLeft` and `trimRight`, `Date.prototype.getYear`, `setYear` and
  `toGMTString`, and `RegExp.prototype.compile` are ordinary builtins a strict
  program can call. Each is built or missing like any other builtin. The
  `__defineGetter__` family defines and reads accessors while the program
  runs, so it goes with property descriptors
  ([below](#in-scope-not-yet-built)).

test262's `test/annexB` directory is in the strict lane.

## In scope, not yet built

Everything JavaScript defines beyond the three boundaries above is in scope.
These come after the static foundations are solid, each with the best
representation the compiler can prove, chosen when its time comes. Each is to
cost nothing in a program that does not use it: the compiler proves which
values a use can reach, and only those values pay.

| feature | today | how it is to cost nothing |
|---|---|---|
| `globalThis` | refused | open question L24 |
| `Proxy` and `Reflect` | refused; every `Reflect` member as reflection | L25 |
| object integrity: `Object.freeze`, `seal`, `preventExtensions`, `isFrozen`, `isSealed`, `isExtensible` | refused; `seal`, `preventExtensions`, `isSealed` and `isExtensible` as reflection | L26 |
| property descriptors: `Object.defineProperty`, `defineProperties`, `getOwnPropertyDescriptor`, `getOwnPropertyDescriptors` | refused as reflection | with L25 and L26: `Reflect` and the integrity levels are defined in terms of them |
| reading a prototype and choosing one at creation: `Object.getPrototypeOf`, reading `__proto__`, `Object.create` given a prototype object, `__proto__` in an object literal | `Object.getPrototypeOf` refused as "prototype and descriptor reflection", `Object.create` of an object because a layout has no prototype slot; `Object.create(null)` makes a dictionary and compiles | a prototype slot only in the values the compiler proves are made with a chosen prototype; `Reflect.getPrototypeOf` with L25 |
| more than one realm: test262's `$262.createRealm`, an iframe's own intrinsics | one realm, laid out by the compiler | a second set of intrinsics only in a program that makes one |
| `Symbol.toPrimitive` and `Symbol.hasInstance` | a type that declares `[Symbol.toPrimitive]` is refused where it is converted; `instanceof` answers from the class hierarchy | the compiler sees which types declare a hook, and only conversions and `instanceof` on those types call it |

The compiler's reflection message calls this family a representation
boundary. This page, not the message, states the scope.

Their test262 cases are to count in the denominator. Today `features.json`
still classes `Proxy`, `Reflect`, `Reflect.construct`, `globalThis`,
`nonextensible-applies-to-private`, `Symbol.hasInstance`,
`Symbol.toPrimitive`, `__proto__` and `cross-realm` as `inapplicable`, and
`test262-exclusions.json` excludes every case that includes
`propertyHelper.js`; narrowing both files to the three boundaries is planned
([plan](../plan.md#backlog)). The node tests a module lists as not applicable
for these features are in scope the same way.

## Not boundaries

These are refused or wrong today, and each is a gap or an open question, never
a boundary:

- the `arguments` object, decided to be implemented
  ([functions](functions.md#decisions));
- reads where JavaScript answers `undefined` but the type promises a value:
  holes, out-of-range indexes, uninitialized slots. They abort, read 0 or
  refuse, depending on the backend, and are decided to give `undefined`
  ([types](types.md#when-a-types-claim-is-false-at-run-time));
- member reads by a key known only while the program runs, decided to go
  through a table of member names per type ([types](types.md#decisions));
- decorators, refused by name until the standard semantics are implemented
  ([language](README.md#decisions)), and proper tail calls, decided to be
  implemented ([functions](functions.md#recursion));
- a function's `length`;
- a function's source text: `toString` gives `function NAME() { [native code] }`
  on every backend, where node gives the source. Decided: the source is kept for
  each function whose `toString` the compiler can see is called, so no other
  program pays for it (not built);
- `Intl`, which is in scope with locale subsets, and Temporal;
- `Atomics` and `SharedArrayBuffer`, which come with workers.

## Decisions

- There are three permanent boundaries, and nothing else is one: code made
  from text while the program runs, changing an existing object's prototype,
  and sloppy mode, `with` included. Everything else JavaScript defines is in
  scope (user, 11-05,
  [log](../records/notebooks/decisions-log.md#language-boundaries-11-05)).
  - `Object.setPrototypeOf`, `Reflect.setPrototypeOf` and assigning
    `__proto__` are refused; reading a prototype and choosing one when an
    object is made are in scope.
  - `eval`, and the `Function` family given source text known only at run
    time, are refused; source the compiler proves constant may be compiled
    later, as an optimization, and their test262 cases leave the denominator
    (L1; 10-28, [log](../records/notebooks/decisions-log.md#language-10-28)).
  - Nothing is compiled in sloppy mode; a CommonJS dependency comes in through
    an interop layer (L18; 10-28,
    [log](../records/notebooks/decisions-log.md#language-10-28)).
  - Reading the prototype chain, realms, `Symbol.toPrimitive` and
    `Symbol.hasInstance` join `globalThis`, `Proxy` with `Reflect`, object
    integrity and the property descriptors in scope. Each is built after the
    static foundations, with the best representation the compiler can prove,
    and costs nothing where a program does not use it
    ([log](../records/notebooks/decisions-log.md#language-and-hosts-10-27)).
- A function's source text is kept only where its `toString` is reachable
  ([log](../records/notebooks/decisions-log.md#language-and-hosts-10-27)).
- Intl is in scope, with locale subsets
  ([log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22)).
