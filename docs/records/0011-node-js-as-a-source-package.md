# 0011 — Node.js as a source package, measured

Status: measured, not built
Recorded: 2026-08-27
Subject: `docs/node-js.md` (RFC NTS-NODE-001), §1

The RFC proposes consuming a pinned Node.js checkout and compiling `lib/*.js`
through this frontend, "attaching public TypeScript signatures" and "inferring
internal helper types". Node's `lib/` is JavaScript, and this compiler takes
every type from tsgo's checker, so the claim rests on how much of that
JavaScript the checker can type and the lowering can accept.

That is a measurable question, so it was measured before anything was designed.
The corpus is `third_party/node` at `v24.20.0`, sparse-checked-out to `lib/`:
372 files. The clone command is in `.gitignore` with the others.

## `.js` is not the problem

The first thing to establish is whether the frontend can see JavaScript at all.
It can, and the result is not "mostly":

```ts
export function addTs(a: number, b: number): number { return a + b; }
```
```js
/** @param {number} a @param {number} b @returns {number} */
function addJs(a, b) { return a + b; }
```

lower to the *same* HIR — `%2 = add %0, %1 : f64` in both. With `allowJs` and
`checkJs`, a JSDoc-annotated `.js` file is an ordinary input. Nothing about
Node's library being JavaScript is an obstacle in itself.

Nothing in the suite covers this, which is worth fixing before it is relied on.

## All 372 files

Every external stubbed as `any`, `noImplicitAny` off — the most generous setup
that can be arranged:

| | files |
| --- | ---: |
| typecheck | 153 |
| rejected by the typechecker | 219 |
| **functions lowered** | **0** |

Zero. Across the 153 files that typecheck, not one function reaches HIR. The
789 refusals rank as:

| refused | count |
| --- | ---: |
| a parameter of unrepresentable type (any) | 401 |
| a function without a body | 150 |
| a property of unrepresentable type (an object type) | 81 |
| a method with a computed name | 35 |
| a module-scope variable with no initializer | 23 |
| an object with an accessor | 19 |
| a call returning an unrepresentable type | 17 |
| a module-scope variable whose initializer is not constant | 14 |
| a name declared outside this function | 11 |

The first two rows are largely the measurement's own fault and are recorded
that way deliberately: `primordials` was stubbed as `any`, so every primordial
call site inherits it, and the stub `declare`s account for most of the bodiless
functions. The rows beneath them are the honest signal.

## `any` is the second wall, not the first

`lib/path.js` is the most nearly-pure module Node has: 1713 lines, seven
top-level functions, 23 object-literal methods, and only four internal
requires. With its internals stubbed as `any`, **none of the seven lower** and
six refuse with `a parameter of unrepresentable type (any)`. That is the
predicted wall, and it looks final.

It is not. A 38-line `.d.ts` giving real signatures to the fifteen primordials
and four internal modules `path.js` actually touches, plus JSDoc on the six
unannotated functions, removes **every** `any` refusal from the file. The cost
is bounded and mostly shared: `primordials` is written once for all 372 files.

What was left after that was not `any` at all. It was module scope.

## What is actually in the way

Each of these has a minimal reproduction in the probe directory.

- `const { DOT } = bag;` at module scope is refused — *for a plain number*.
  `collect_module_scope` finds a name by looking for an `IDENTIFIER` child of
  the declaration, and a binding pattern has none, so the symbol is never
  registered and the use falls through to the generic "a name declared outside
  this function". Node destructures `primordials` at the top of every file, so
  this one gate stands in front of all 372.
- `break` and `continue` are refused, bare in a loop body.
- An interpolated template literal is refused.
- A module-scope object literal is refused where a function reads it.

Working, and worth knowing: module-scope `const` scalars fold, module-scope
`let` becomes a global, classes with ordinary methods lower, and a higher-order
function parameter lowers as long as the program contains at least one arrow —
the closure slot only exists once some closure class has been built.

## The measurement that decided it

`normalizeString` is the core of `path`: a 64-line loop that every public
function routes through. Taken **byte-identical** from `lib/path.js:92-155`,
with only the scaffolding changed — the primordials it calls made into plain
function declarations, `CHAR_*` into module consts — it lowers. Three things
stop it: `break`, `continue`, and one template literal.

That asymmetry is the finding. Node's *algorithms* are within reach of this
compiler. Node's *scaffolding* — destructured primordials, module-scope object
literals, `module.exports = {…}`, `internalBinding` — is not, and it is the
part that would need patching per file, forever.

## An exported API can disappear silently

```ts
export const bag = { isDot(c: number): boolean { return c === 46; } };
```
```text
0 function(s), nothing refused
```

No HIR, no diagnostic, through `--prepared` as well. The same happens for an
arrow-valued property. RFC §4.1 requires that unsupported reachable behavior be
diagnosed precisely, and this is reachable, unsupported, and silent.

The consequence is worse than the bug. The refusal histogram in `README.md` is
the work queue, and a histogram can only rank what gets reported — so the queue
is systematically biased against whatever fails quietly. This should be fixed
before more decisions are taken from that table, including the ones above.

## `unknown` is refused, and `docs/any-unknown.md` says it must not be

`function inc(value: unknown)` is refused with `a parameter of unrepresentable
type (unknown)`. That document is explicit that `unknown` is a supported top
type in parameters, locals, fields and arrays, and that the compiler "must not
reject `unknown` merely because it requires an erased representation". A
comment at the refusal site already concedes the point. Neither the `unchecked`
provenance tracking for declaration-originated `any` nor the trusted-boundary
semantics that document describes exist anywhere in `compiler/`.

## What this argues for

The RFC's §1 is half right, and it is the cheap half. Attaching signatures
works and costs little. Inferring internal helper types does not happen — tsgo
answers `any` — and the RFC does not account for the cost that actually
dominates, which is that Node's module scaffolding is precisely the set of
constructs this lowering lacks.

Two options were on the table: compile `lib/` as-is, or hand-write a TypeScript
`node:path` and demote Node's source to a conformance oracle. The evidence
supports neither. 219 of 372 files do not typecheck under any arrangement —
`events.js` needs prototype inheritance and `export =`, `punycode.js` reassigns
variables across types — so compiling `lib/` as-is is not available. But
discarding it wastes algorithms that already lower.

The third option is to keep Node's function bodies and own the scaffolding
around them, with real `node:path` as the fidelity oracle. It is also the
cheapest, because the enabling work is not Node-specific: `a name declared
outside this function` is already first in the corpus histogram, and
`a module-scope variable whose initializer is not constant`, `an object with an
optional property` and `this statement` are all in its top twelve. Node's
`lib/` exercises the queue that exists, harder. There is no separate Node
problem at the lowering level.

## The experiment that tested it

`examples/node-path` is that third option carried out on one module: the posix
half of `node:path`, bodies transcribed from `lib/path.js`, scaffolding
replaced. Seven functions, twenty-eight recorded edits, and two gates that only
mean something together — `fidelity.mjs` agrees with the real `node:path.posix`
on 2856 cases, and `nts check` agrees with node on the compiled program. The
emitted C links against libc and libm and nothing else.

`examples/node-path/PATCHES.md` prices each gap in edits. Twelve of the
twenty-eight are `break`, `continue` and template interpolation — ordinary
control flow with no design question attached, and the cheapest thing on the
list to remove.

The experiment also found a bug that the corpus could not. `s += t` on strings
lowers to `Add` rather than `Concat`, and the emitted C does not compile:
`binary_operator` asks whether the type is managed before choosing `Concat`, and
`compound_operator` never asks. It fails at clang rather than silently, and no
existing example appends to a string, which is why it had not come up.
