# Engine-free `eval` and dynamic function construction

This document records a possible AOT design for `eval`, `Function`, and
`new Function`. It is a design note to revisit, not an implemented feature or
a commitment to support arbitrary runtime-generated JavaScript.

The default NativeTS profile remains engine-free. A build must never silently
add an interpreter, bytecode VM, JIT, runtime compiler, or external compilation
service merely because reachable source uses a dynamic-code API.

## Supported boundary

An engine-free build can execute generated source only when reachability and
string-value analysis prove the exact source text at build time:

```text
one source string
    -> parse and precompile one synthetic source unit

finite set of source strings
    -> precompile every member and emit exact-string dispatch

arbitrary runtime string
    -> AOT-inapplicable diagnostic
```

Constant folding may establish a finite set through literals, constant
concatenation, constant template substitutions, local bindings, and finite
conditionals. The analysis must prove the set; recognizing the spelling
`eval` or scanning source text is not sufficient.

```js
function calculate(value, multiply) {
  const source = multiply ? "value * 2" : "value + 2";
  return eval(source);
}
```

Both alternatives may be compiled ahead of time. At runtime the original
string value selects the matching compiled entry. An unrecognized string is
not sent to a fallback interpreter.

This does not qualify:

```js
eval(readFileSync("plugin.js", "utf8"));
new Function(downloadedSource);
eval("value." + userInput);
```

Executing those inputs would require a dynamic JavaScript implementation by
another name.

## Intrinsic identity

The frontend must distinguish the ECMAScript intrinsics by resolved declaration
identity and call form, not by text alone. A local function named `eval` is an
ordinary call. A syntactic direct call to the intrinsic `eval` has direct-eval
semantics; an alias, comma expression, property access, or other indirect call
has indirect-eval semantics.

```js
eval("x");             // direct
const run = eval;
run("x");              // indirect
(0, eval)("x");        // indirect
globalThis.eval("x");  // indirect
```

Calling `eval` with a non-string returns the argument unchanged. That path
participates in ordinary representation analysis and does not parse source.

## Direct `eval`

A precompiled direct-eval unit executes against the environment of its call
site. It must preserve:

- access to and mutation of visible lexical bindings;
- the caller's strictness and the eval source's own directive prologue;
- `this`, `new.target`, and the relevant `super` environment where permitted;
- eval completion values;
- lexical declarations scoped to the eval unit;
- non-strict `var` and function declarations targeting the correct variable
  environment; and
- the realm and intrinsic identities of the original call.

Because the source set is known, the compiler can reserve every required
environment slot and lower each eval unit like a synthetic nested function.
Strict direct eval is the smaller first slice because its declarations cannot
leak into the caller's variable environment. Non-strict direct eval comes
later and requires the full declaration-instantiation rules.

## Indirect `eval`

Indirect eval parses and executes as global script code in the eval intrinsic's
realm. A precompiled indirect-eval alternative is therefore a synthetic global
script unit, not a closure over the caller.

It still executes only when the call occurs. Precompilation must not perform
its side effects during program initialization.

## `Function` and `new Function`

All parameter fragments and the body argument must reduce to one finite set of
exact strings after ECMAScript `ToString` conversion. Each valid combination is
parsed using the dynamic-function grammar and compiled as an ordinary function
whose outer environment is the appropriate global environment, never the
caller's lexical environment.

The machine code may be shared, but every executed constructor call creates a
fresh function object:

```js
new Function("return 1") !== new Function("return 1");
```

`Function(...)` and `new Function(...)` use the same construction semantics.
Async and generator constructors follow the same finite-source rule once those
function kinds exist.

## Error timing and observability

Parsing during the build must not move an observable JavaScript error earlier.
If one known alternative has a syntax or early error, the compiler records that
result and emits a call-site path that throws the correct ECMAScript error when
that alternative is selected:

```js
try {
  eval("let =");
} catch (error) {
  // The SyntaxError occurs here, not as a NativeTS build failure.
}
```

The same rule applies to invalid `Function` parameter and body combinations.
Generated functions and eval frames need stable synthetic source identities so
stack traces, breakpoints, and coverage can refer back to the call site and the
exact generated source hash.

## Representation recovery

Every precompiled alternative joins the ordinary whole-program analysis in
[`any-unknown.md`](any-unknown.md). Captured inputs, returned completion values,
and writes into the surrounding environment contribute representation evidence
and operation requirements.

```js
const source = condition ? "41 + 1" : "'forty-two'";
const result = eval(source);
```

The result may use a closed `Number | StringRef` representation. It does not
introduce `Any` into HIR. Operations inside generated code are legalized in the
same way as operations in ordinary source.

## Package-known source registry

A later engine-free extension may accept an explicit build manifest of source
files or exact source strings. The build precompiles every registered entry,
and a runtime call succeeds only when its input bytes exactly match one entry.
This can support packaged scripts that are selected at runtime without
supporting downloaded or user-generated code.

Registry entries do not weaken direct-eval environment rules. They are most
natural for indirect eval and dynamic function construction; direct eval still
requires a call-site-specific environment descriptor.

## Test262 policy

Tests whose reachable dynamic source reduces to a finite set are applicable and
must receive their ordinary Test262 verdict. Tests requiring a genuinely
arbitrary runtime string are explicitly `inapplicable` in the engine-free AOT
profile, not `pass`, `unsupported`, or a representation-recovery failure.

The pinned suite contains many literal and finitely derived eval/function
sources, so this design should cover a useful subset without changing the
default runtime model. The eventual runner must classify from the
compiler's reachable dynamic-source result; a textual search for `eval` or
`Function` cannot determine applicability.

## Suggested implementation order

1. Constant `Function` and `new Function`.
2. Finite-set dynamic function construction.
3. Constant and finite indirect eval.
4. Strict direct eval.
5. Non-strict direct eval and declaration instantiation.
6. Explicit package-known source registries.

Arbitrary runtime source remains outside the engine-free profile.
