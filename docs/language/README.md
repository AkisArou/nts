# The language

The TypeScript nts compiles, feature by feature, and what each construct means
in a compiled program. For anyone deciding whether a program will compile, or
looking for where a feature stands. The pages beside this one say what the
features mean in detail; this one is the map.

## What nts compiles

- **TypeScript in.** The input is TypeScript, and JavaScript under `allowJs`.
  TypeScript's checker, tsrs, runs inside the compiler and answers every type
  question, so a program means what `tsc` says it means, and a program that
  does not type-check does not compile.
- **Strict ES modules.** Every file is a strict ES module. Sloppy mode, `with`
  and legacy octal literals do not exist in that language, and CommonJS is not
  compiled ([modules.md](modules.md)).
- **Typed layouts.** A static type decides a value's representation: a class
  or object type is a flat struct, a number proved whole is an integer, and
  `any`, `unknown` and mixed unions are erased values that carry a tag
  ([types.md](types.md)).
- **The specification decides, and node is the oracle.** The ECMAScript
  specification (test262) decides what the language means; node decides what
  the specification leaves to the host: node's APIs, `console`'s format, timer
  order and the report of an uncaught error. A compiled program prints what
  node prints running the same source, and node is the oracle every fixture is
  compared with. Where node lacks a feature the specification has, such as
  proper tail calls or `Temporal`, nts provides it (neither is built yet), so
  a program that works on node behaves the same and some that fail on node
  run. Where nts cannot
  match, it refuses the construct at compile time, naming it, or stops at run
  time by name. A wrong answer that runs is a defect, recorded under
  `tests/outcomes/` until it is fixed.

A refusal names the construct and why (`NTS1001 ... is not supported by this
lowering yet`). A builtin no provider supplies is NTS1100, and `eval` is
NTS1101. Any refusal fails `nts build`; `--partial` writes the program without
the refused parts, for experiments, and says so
([cli](../reference/cli.md#refusals-by-command)). `nts refusals` lists what a
program refuses.

## How to read the tables

| Mark | Meaning |
|---|---|
| compiled | lowers, and agrees with node wherever the result is observable |
| partly | the common shapes compile; the rest is refused by name |
| not yet | refused today, and wanted |
| out of scope | not compiled, by design: [boundaries.md](boundaries.md) says why |

The marks are features, not tests. The measured state is in `results/`
([below](#where-the-measured-state-lives)).

## Expressions and operators

| Feature | Mark | Notes |
|---|---|---|
| arithmetic, `**`, unary operators, comparisons, `&&`, `\|\|`, `?:`, compound assignment | compiled | JavaScript's values on doubles; integers where proved ([numbers.md](numbers.md)) |
| bitwise operators and shifts | compiled | through `ToInt32` and `ToUint32` |
| `===`, `!==`; `==` and `!=` against `null` or `undefined` | compiled | |
| `==` and `!=` that coerce (`"1" == 1`) | not yet | refused: no `ToPrimitive` to coerce with |
| `typeof`, `instanceof` | compiled | |
| `in`, including names inherited from the prototype (`"valueOf" in {}`) | partly | a key that is not a literal the compiler can see is refused |
| template literals | compiled | |
| tagged templates | partly | the tag must be a plain declared function; `String.raw` is refused |
| object and array literals: shorthand, constant computed keys, holes, methods, getters and setters | compiled | two literals of one interface type that each declare a method are refused |
| spread in array literals (of arrays, `Set`s, `Map`s and their walks) and in object literals | compiled | a spread of an erased value is refused |
| spread into a call | partly | an array whose length the compiler cannot see is refused |
| `?.`, `??`, `??=`, `\|\|=`, `&&=` | compiled | |
| `delete` | partly | of an optional property only |
| `void`, the comma operator | compiled | |
| a member read or write by a key known only at run time | partly | on arrays and index signatures (`Record<string, T>`); on any other type it is refused; decided: a read on `any` or `unknown` goes through a table of member names per type ([types.md](types.md#decisions)) |
| JSX | partly | only through the React Compiler's transform (`react` in [`nts.config.ts`](../reference/nts-config.md#top-level-fields)); decided: compiled in the compiler's core, for any JSX library ([Decisions](#decisions)) |
| `valueOf` and `toString` called by a conversion | partly | a static dispatch; refused where both answer objects |

## Statements and control flow

| Feature | Mark | Notes |
|---|---|---|
| `if`, `switch` with fall-through, `for`, `while`, `do` | compiled | |
| `break`, `continue`, labels on any statement | compiled | |
| `let`, `const`; destructuring with defaults, rests, nesting and holes, in declarations, assignments and loop heads | compiled | |
| `var` | partly | function-scoped and hoisted; a read before its assignment is a wrong answer or a stop today, and is decided to read `undefined` ([types.md](types.md#when-a-types-claim-is-false-at-run-time)); a closure over a loop's `var` is refused |
| `for...of` | compiled | see [iteration](#iteration) |
| `for...in` | partly | over an object's keys; over an array it is refused |
| `throw`, `try`, `catch`, `finally` | partly | some throws through indirect calls escape their `try` ([errors.md](errors.md#throws-that-escape-a-try)) |
| `using`, `await using` | not yet | decided, with the full iteration protocol ([async.md](async.md#decisions)) |
| `with`, sloppy-mode code, legacy octal literals | out of scope | not in strict code; the checker rejects them ([boundaries.md](boundaries.md#sloppy-mode)) |

## Functions

| Feature | Mark | Notes |
|---|---|---|
| declarations, expressions and arrows, nested and hoisted | compiled | [functions.md](functions.md) |
| optional, default, rest and destructured parameters; overloads | compiled | |
| closures, including over variables something writes | compiled | some capture shapes are refused |
| functions and methods as values | compiled | `o.m === o.m` is `false`; decided: `true`, by caching method values per class ([functions.md](functions.md#decisions)) |
| `this` in functions; `call`, `apply`, `bind` | compiled | a `this:` type is proved at entry |
| the `arguments` object | not yet | decided: implemented, unaliased as strict mode has it ([functions.md](functions.md#decisions)) |
| generic functions | compiled | copied per instantiation |
| recursion | compiled | no depth limit: stack exhaustion stops by name |
| proper tail calls | not yet | decided: implemented ([functions.md](functions.md#recursion)) |
| `async` functions and `await` | compiled | [async.md](async.md) |
| generators | partly | the value of a `yield` is refused |
| a function's source text (`String(f)`) | partly | `function f() { [native code] }` on every backend, where node gives the source; decided: the source is kept for each function whose `toString` the compiler can see is called ([boundaries](boundaries.md#not-boundaries)) |

## Classes and objects

| Feature | Mark | Notes |
|---|---|---|
| fields: public, `private`, `protected`, `readonly`, `static`, `#private`; initializers; parameter properties | compiled | |
| constructors; methods, getters and setters, public or `#private`; `static` members and `static {}` blocks | compiled | |
| inheritance, `super`, `override`, `abstract`, `implements`, virtual dispatch | compiled | |
| class expressions; classes declared inside a function | partly | a class declared in a function is one class for every call, sharing its statics, and a class object per evaluation is decided ([functions.md](functions.md#decisions)); refused: a class expression not bound to a name, and a class that reads the enclosing function's locals |
| a class as a value: stored, passed, returned, compared | compiled | |
| an error class called without `new` (`TypeError("m")`); `new` through a value holding a class | not yet | |
| generic classes | partly | copied per instantiation; a generic method on a generic class is refused, and so is an exported generic class nothing instantiates (register [L9](../open-questions.md#1-language-and-compiler)) |
| members keyed by symbols, including `[Symbol.iterator]()` | compiled | |
| `#x in o` | compiled | |
| `new.target` | not yet | refused, as `a meta property`; decided: implemented ([functions.md](functions.md#decisions)) |
| decorators | not yet | standard decorators are compiled away silently today; decided: refused by name until the standard semantics are implemented ([Decisions](#decisions)); `experimentalDecorators` is refused |
| auto-accessors (`accessor x = 1`) | not yet | the `accessor` modifier is not read, so the member compiles as a plain field (L10) |
| `Object.freeze`, `seal`, `preventExtensions`; property descriptors (`Object.defineProperty`, `getOwnPropertyDescriptor`); `Proxy` and `Reflect`; `globalThis` | not yet | in scope later, after the static foundations and a discussion ([boundaries.md](boundaries.md#in-scope-not-yet-built); registers [L24 to L26](../open-questions.md#1-language-and-compiler)) |
| the prototype chain: `Object.getPrototypeOf`, `setPrototypeOf`, `__proto__`, `Object.create(proto)` | out of scope | [boundaries.md](boundaries.md#the-prototype-chain); `Object.create(null)` compiles |
| redirect hooks: `Symbol.toPrimitive`, `Symbol.hasInstance`, `Symbol.unscopables` | out of scope | the static type decides conversion and `instanceof` ([boundaries.md](boundaries.md#redirect-hooks)) |
| the wrapper objects (`new String`, `new Number`, `new Boolean`) | not yet | |

## Modules

| Feature | Mark | Notes |
|---|---|---|
| `import` and `export` in every ES form; default and namespace imports; re-exports | compiled | [modules.md](modules.md) |
| cycles; evaluation order | compiled | every module in the program runs at startup |
| `import()` of a module of the program | compiled | a computed specifier is refused |
| top-level `await`, `import.meta`, JSON and text modules | not yet | decided: implemented ([modules.md](modules.md#decisions)); what `import.meta.url` holds is register [L17](../open-questions.md#1-language-and-compiler) |
| npm dependencies | partly | compiled from their TypeScript source; JavaScript-only packages are not yet, and are decided to compile against their JSDoc and `.d.ts` types ([modules.md](modules.md#decisions)) |
| `node:*` modules | not yet | no resolver yet; decided: all 28 modules on native, through a `node:` resolver ([modules.md](modules.md#decisions)) |
| CommonJS | not yet | decided: CommonJS dependencies come in through an interop layer, and sources stay strict ES modules ([modules.md](modules.md#decisions)) |

## The type system

| Feature | Mark | Notes |
|---|---|---|
| aliases, unions, intersections, literal types, tuples | compiled | |
| `keyof`, `typeof`, indexed-access, mapped, conditional and template literal types | compiled | types only: nothing at run time |
| interfaces, satisfied by shape | compiled | [types.md](types.md#interfaces-are-satisfied-by-shape) |
| `any`, `unknown`, `object` | compiled | as erased values |
| `as`, `satisfies`, `as const`, `!` | compiled | `as` and `!` are checked where a wrong claim would be read |
| optional and `readonly` properties, index signatures | compiled | |
| `enum`, numeric and string; `const enum` | compiled | the reverse mapping at a computed index is refused |
| `declare` | compiled | a declared function is bound as a C function today; decided: `declare` names what the environment provides, and C is reached only through `c:` imports ([modules.md](modules.md#decisions)) |
| function types | compiled | |
| constructor types | not yet | `new` through one is refused |
| namespaces; declaration merging | partly | calls to a namespace's functions, and an enum merged with a namespace, compile; a namespace holding a value is refused; both are decided, as TypeScript emits them ([modules.md](modules.md#decisions)) |

## Values

| Feature | Mark | Notes |
|---|---|---|
| `number`, `boolean`, `string`, `symbol`, `null`, `undefined` | compiled | `null` and `undefined` are two values |
| `bigint` | partly | exact to 128 bits, then stops by name ([numbers.md](numbers.md#bigint)) |
| arrays, tuples, objects | compiled | |
| `Map`, `Set` | partly | built empty or from an array; walked by `for...of`, `forEach` and `Array.from` |
| `ArrayBuffer`, including resizable and transferable; `DataView` | compiled | |
| typed arrays | partly | the eight numeric kinds; `Uint8ClampedArray`, `Float16Array`, `BigInt64Array` and `BigUint64Array` are not provided |
| `Date` | partly | the time value only: `new Date(ms)`, `getTime`, `valueOf` |
| `WeakMap`, `WeakSet`, `WeakRef`, `FinalizationRegistry` | not yet | no representation yet |
| `SharedArrayBuffer`, `Atomics` | not yet | decided: on C11 atomics, with workers ([async.md](async.md#decisions)) |

## ECMAScript globals

One list of provided globals serves every target today; the approved design
that replaces it is [foundations/builtins.md](../foundations/builtins.md).

| Feature | Mark | Notes |
|---|---|---|
| `Math` | partly | all but `random`, `clz32`, `asinh`, `acosh`, `atanh` and `f16round`; not yet bit-identical to node |
| `Number`, `parseInt`, `parseFloat`, the URI functions | partly | `toPrecision` and `toExponential` are refused |
| `String` and its methods | partly | `fromCharCode` and `fromCodePoint` take one argument |
| `JSON.stringify` | partly | one argument, of a stated type |
| `JSON.parse` | not yet | |
| `RegExp`: literals, `new RegExp`, string methods taking a pattern | not yet | the TypeScript engine in `runtime/ecmascript` is not wired in |
| `Promise` | partly | `allSettled`, `any` and `try` are not provided |
| the error classes | partly | eight classes and `cause`; `SuppressedError` and `stack` are refused ([errors.md](errors.md)) |
| `Symbol`, `Symbol.for`, `description` | partly | a well-known symbol works as a key, not as a value |
| `Object.keys`, `values`, `entries`, `is`, `hasOwn`, `assign` | partly | `fromEntries` and `groupBy` are not provided |
| `Array.isArray`, `Array.from` | partly | `Array.of` and `fromAsync` are not provided; an array-like is refused |
| `console.log` and its siblings | partly | primitive values only; decided: values formatted as node's `util.inspect` does ([builtins](../foundations/builtins.md#decisions)) |
| the clock and randomness: `Date.now`, `new Date()`, `Math.random` | not yet | designed in [builtins](../foundations/builtins.md#the-clock-and-randomness) |
| the calendar: `getFullYear` and its family, `toISOString` | not yet | |
| `Intl`, `Temporal` | not yet | implementations in `runtime/ecmascript` are not wired in |
| `eval`, `Function` from source text | out of scope | a permanent boundary: `eval` is NTS1101 and the `Function` constructor NTS1100 ([boundaries.md](boundaries.md#dynamic-code)) |

## Iteration

| Feature | Mark | Notes |
|---|---|---|
| `for...of` over arrays, strings (by code point), `Map`, `Set` and their `keys`, `values` and `entries` | compiled | nothing allocated per element; a `Map`'s entry is bound as `[key, value]` |
| `for...of` over a user iterable (`[Symbol.iterator]()`) or a generator | compiled | |
| `yield*` | compiled | as a statement |
| iterator closing: `return()` on an early exit | partly | a user iterator's `return()` is called; a generator left early is not closed, a generator's `finally` around a `yield` is refused, and a `break` out of `for await` leaves its generator open |
| a generator stepped by hand with `next()` | compiled | its `return()` and `throw()` are refused |
| the value of a `yield`, which `next(v)` hands in | not yet | |
| `for await` over an async generator | compiled | |
| `for await` over an `AsyncIterable` object or a synchronous sequence | not yet | |
| iterator helpers (`map`, `filter`, `take`, `Iterator.from`) | not yet | |

The whole protocol is decided, as phase 3 work ([async.md](async.md#decisions)).

## Evaluation order

| Feature | Mark | Notes |
|---|---|---|
| operands left to right, callee before arguments, short-circuits | compiled | |
| an assignment target evaluated once (`xs[next()] += 1`) | compiled | |
| `return`, `break`, `continue` and `throw` through `finally` | compiled | |
| module evaluation order; the temporal dead zone | compiled | [modules.md](modules.md#evaluation-order) |

## Where the measured state lives

| Where | What it holds |
|---|---|
| [`results/typescript/`](../../results/typescript) `<backend>/cases.tsv` | the TypeScript conformance cases (`tests/typescript/`, indexed by concept in `tests/typescript/FEATURES.md`) that ran on each backend, and what each did |
| [`results/test262/`](../../results/test262) `<backend>/<slice>.tsv` | the test262 cases that ran on each backend ([conformance/test262.md](../conformance/test262.md)) |
| [`results/suite/corpus.md`](../../results/suite/corpus.md) | TypeScript's own tests compiled as programs: how many lower or refuse, and the refusals that stop the most |
| `tests/refusals/` | each refusal, with the message it must give |
| `tests/outcomes/` | each known wrong answer or crash, until it is fixed |

## The pages

- [types.md](types.md): types as layouts, `any` and `unknown`, casts,
  interfaces by shape, and what happens when a type's claim is false.
- [numbers.md](numbers.md): `number`, integers, BigInt and the scalar types.
- [functions.md](functions.md): closures, function values, `this` and methods.
- [errors.md](errors.md): exceptions, uncaught errors, host callbacks and stack
  traces.
- [async.md](async.md): promises, `async` functions, generators, timers and the
  event loop on each target.
- [modules.md](modules.md): modules, packages, `node:*` and the module forms not
  yet compiled.
- [boundaries.md](boundaries.md): what nts does not compile, and why.

## Decisions

- One full lib (ESNext plus DOM) for every target, with NTS1100 "not on this
  target", not per-target libs (10-22, decision 11,
  [Builtins and runtimes](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22)).
- `typeof X === "undefined"` folds where a target lacks `X` (decision 7, same
  entry).
- Intl is in scope, with locale subsets (decision 1); `WeakRef` and
  `FinalizationRegistry` are represented, not designed around (decision 4);
  RegExp literals get matchers generated at compile time, with the TypeScript
  interpreter for dynamic patterns (decision 5). Same entry; none is built.
- `globalThis`, `Proxy` with `Reflect`, object integrity and the property
  descriptors are in scope for later, after the static foundations and a
  discussion, each costing nothing where a program does not use it (10-27,
  [Language and hosts](../records/notebooks/decisions-log.md#language-and-hosts-10-27)).
- The ECMAScript specification decides what the language means, and node what
  the specification leaves to the host; where node lacks a feature the
  specification has, nts provides it (L23; 10-28,
  [log](../records/notebooks/decisions-log.md#language-10-28)).
- Decorators are refused by name until the TC39 standard semantics are
  implemented, later; JSX is compiled in the compiler's core, for any JSX
  library, with TypeScript's own JSX emit as the oracle (L10; 10-28,
  [log](../records/notebooks/decisions-log.md#language-10-28)). Neither is
  built.
- The TypeScript nts compiles follows tsrs's releases of stable TypeScript,
  and each upgrade is gated by the four conformance suites (L19; 10-28,
  [log](../records/notebooks/decisions-log.md#language-10-28)).
