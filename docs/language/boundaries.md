# Boundaries

What nts does not compile, and why. A boundary is a decision: the construct is
out of scope on principle, and it is in no backlog. A gap is different: it is
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

Most boundaries follow from how an object is represented. Each type has one
layout, fixed at compile time: a header, then the fields at offsets the
compiler chose. In the native runtime the header holds the type's descriptor,
a word the memory provider owns, flags and a length. The descriptor holds the
size, which offsets hold references, the method table and the type's name. The
JVM and Wasm keep the same model as one class or one struct per type.

There is no prototype pointer and no property map, so reading a property of a
known type is a load at a known offset. What that rules out, a typed program
rarely needs: its types already say what each object holds, and replacing a
prototype or redefining a property while the program runs is not what typed
code does.

## Dynamic code

`eval`, and `Function` or `new Function` given source text, run JavaScript
that exists only while the program runs. A compiled program carries no
parser, interpreter or JIT, and nts never adds one because a program reaches
these. `eval` is refused as NTS1101, "never provided", and the `Function`
constructor as a builtin nts does not provide (NTS1100).

This is out of scope for now. Whether it is permanent is open question
[L1](../open-questions.md#1-language-and-compiler). Its recommendation is a
permanent boundary, except for source the compiler proves constant, which a
[design note](../records/notebooks/eval.md) shows how to compile ahead of time. Until L1 is
decided, test262's `eval` and `Function` cases are not excluded: they count in
the in-scope denominator.

## The prototype chain

A value's prototype is its type's, and it cannot change. There is no prototype
object to read, replace or build from, so these are out of scope:
`Object.getPrototypeOf`, `Object.setPrototypeOf`, `__proto__` (the accessor
and the object-literal key), and `Object.create` given a prototype object.
The first two are refused as "prototype and descriptor reflection", and
`Object.create` of an object because a layout has no prototype slot to hold
it. `Object.create(null)` makes a dictionary and compiles, and `instanceof`
against a class answers from the class hierarchy.

`Reflect.getPrototypeOf` and `Reflect.setPrototypeOf` belong to `Reflect`,
which is in scope ([below](#in-scope-not-yet-built)). Where they meet this
boundary is part of open question L25.

## Realms

A compiled program is one realm: one set of intrinsics, laid out by the
compiler, and no way to make a second. Nothing crosses realms, so test262's
`$262.createRealm` is not provided and its `cross-realm` cases are excluded.
That one realm's global object, `globalThis`, is in scope
([below](#in-scope-not-yet-built)).

## Redirect hooks

`Symbol.toPrimitive`, `Symbol.hasInstance` and `Symbol.unscopables` let a
program redirect a built-in operation while it runs: conversion to a
primitive, `instanceof`, and name lookup inside `with`. nts decides each of
these operations from the static type instead. A conversion calls the type's
own `valueOf` and `toString`, `instanceof` tests the class hierarchy, and
there is no `with` ([sloppy mode](#sloppy-mode)). A type that declares
`[Symbol.toPrimitive]` is refused where it is converted.

The decided set is these three. `Symbol.species` is not in it, and its test262
cases count as in scope.

## Sloppy mode

Every TypeScript source is strict mode code: the checker parses each file as
strict, whether or not it is a module. So what only sloppy mode allows, such
as `with`, legacy octal literals and octal escapes, is an error before nts
lowers anything, and what only sloppy mode means (`this` as the global object
in a plain call, an assignment that creates a global) never arises. A
function's legacy `caller` property is a sloppy-mode extension and is not
provided.

In test262, `noStrict` and `raw` files are scope-excluded: counted, and not
attempted ([test262](../conformance/test262.md#scope-at-the-pin)). Every
`caller` case is a `noStrict` file. A JavaScript dependency written for sloppy
mode, and CommonJS, are open question L18.

## Annex B

Annex B of ECMA-262 holds legacy web features, in two halves, and only one of
them is a boundary.

- **Its syntax and semantics for sloppy mode** go with sloppy mode:
  block-level function hoisting for web compatibility, labelled function
  declarations, function declarations as `if` clauses, and initializers in
  `for-in` heads. Its `__proto__` goes with the prototype chain, and
  `[[IsHTMLDDA]]`, the slot behind `document.all`, belongs to a host object
  nts never has.
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

The user has put these in scope for later: they come after the static
foundations are solid, and only after a discussion that shows they will not
slow the static design. Each is to cost nothing in a program that does not use it. The compiler proves
which values a use can reach, and only those values pay.

| feature | today | how it is to cost nothing |
|---|---|---|
| `globalThis` | refused | open question L24 |
| `Proxy` and `Reflect` | refused; every `Reflect` member as reflection | L25 |
| object integrity: `Object.freeze`, `seal`, `preventExtensions`, `isFrozen`, `isSealed`, `isExtensible` | refused; `seal`, `preventExtensions`, `isSealed` and `isExtensible` as reflection | L26 |
| property descriptors: `Object.defineProperty`, `defineProperties`, `getOwnPropertyDescriptor`, `getOwnPropertyDescriptors` | refused as reflection | with L25 and L26: `Reflect` and the integrity levels are defined in terms of them |

The compiler's reflection message calls this family a representation
boundary. This page, not the message, states the scope.

Until then their test262 cases stay excluded from the counts: `features.json`
classes `Proxy`, `Reflect`, `Reflect.construct`, `globalThis` and
`nonextensible-applies-to-private` as `inapplicable`, and
`test262-exclusions.json` excludes every case that includes
`propertyHelper.js`. The node tests a module lists as not applicable for them
stay excluded too.

## Not boundaries

These are refused or wrong today, and each is a gap or an open question, never
a boundary:

- the `arguments` object (open question L2);
- reads where JavaScript answers `undefined` but the type promises a value:
  holes, out-of-range indexes, uninitialized slots. They abort, read 0 or
  refuse, depending on the backend (L4);
- member reads by a key known only while the program runs (L7);
- decorators (L10) and proper tail calls (L3);
- a function's `length`;
- a function's source text: `toString` gives `function NAME() { [native code] }`
  on every backend, where node gives the source. Decided: the source is kept for
  each function whose `toString` the compiler can see is called, so no other
  program pays for it (not built);
- `Intl`, which is in scope with locale subsets, and Temporal;
- `Atomics` and `SharedArrayBuffer`, which come with workers.

## Decisions

- `globalThis`, `Proxy` with `Reflect`, object integrity and the property
  descriptors are in scope for later, each to cost nothing where a program
  does not use it. They come after the static foundations, and only after a
  discussion ([log](../records/notebooks/decisions-log.md#language-and-hosts-10-27)).
- A function's source text is kept only where its `toString` is reachable
  ([log](../records/notebooks/decisions-log.md#language-and-hosts-10-27)).
- test262's permanent boundaries are property descriptors, the metaobject
  protocol, the global object and realms, and the redirect hooks
  `Symbol.toPrimitive`, `Symbol.hasInstance` and `Symbol.unscopables`. The
  decision above takes `globalThis`, `Proxy`, `Reflect`, object integrity and
  the descriptors they are defined by out of that set
  ([log](../records/notebooks/decisions-log.md#test262-09-29-10-02)).
- Intl is in scope, with locale subsets
  ([log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22)).
