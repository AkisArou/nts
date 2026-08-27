# test262: what is in it, and how to run it

The whole repository is checked out — 53,872 tests, the harness, and the
metadata specification. It used to be a sparse checkout of three directories,
which meant the answer to "can we test this?" was too often "the files are not
here".

## The correction that matters

Two earlier drafts of this document said test262 could not test *language*
semantics — only built-in library functions — because there was nothing to
substitute for an operator or a statement, and because a differential needs a
value to compare.

**Both premises were wrong, and the second is why.**

A test262 case is **self-checking**. It is silent on success and it `throw`s on
failure. So the signal is the **exit code**, not a returned value. Nothing has to
be harvested, nothing has to be substituted, no function needs a comparable
signature, and no test is edited.

`~/perry` — an ahead-of-time TypeScript compiler in the same position as this one
— does it this way, and its `test-compat/test262/README.md` is the best
description of the technique available.

## How it actually works

Assemble each case exactly as TC39's own runner does, into **one script**:

```text
sta.js  +  assert.js  +  preamble.js  +  any `includes:`  +  the test source
```

`preamble.js` is a tiny host shim providing the two intrinsics a bare runtime
does not have: `print` (async cases report through it) and `$DONOTEVALUATE`
(negative *parse* cases call it on the first line as a tripwire). `onlyStrict`
cases get a `"use strict"` prologue; `raw` cases run verbatim with no harness at
all.

Then run that same assembled script two ways — compiled by us, and under node —
and compare exit codes, with stdout as a tiebreak.

Because **both sides load the identical assembled script**, the comparison is
between the two runtimes' builtins and never between their harnesses.

### The node side must not be `node case.js`

`node file.js` evaluates a file as a **CommonJS module**, so its top-level `var`
and `function` declarations land in the module wrapper instead of on the global
object. A conforming test262 host runs a case as a *global script*, and so does a
compiled binary. The difference is invisible for most cases and breaks any test
whose harness intrinsics must be reachable from global scope.

The fix is one line — run the assembled script through `vm.runInThisContext`,
which restores true script semantics: top-level declarations become globals,
top-level `this` is `globalThis`, and a syntax error still throws at compile time
so negative parse cases keep exiting non-zero.

### Bucket by *agreement*, not by pass

This is the part that makes the numbers honest, because test262 is full of
negative tests where the correct behaviour is to reject:

| bucket | meaning |
| --- | --- |
| `pass` | both ran clean with matching stdout, **or** both rejected — node exits non-zero and we reject at compile *or* run time |
| `diff` | both ran clean, stdout differs |
| `runtime-fail` | we compiled it and disagreed with node |
| `compile-fail` | we refused to compile a case node ran clean |
| `skip` | could not be assembled, needs a `$262` host intrinsic, or is categorically impossible ahead of time |

**A compile refusal is a `pass` when node also rejected.** That is what makes the
4,729 negative tests count correctly instead of being noise.

`parity = pass / (pass + diff + runtime-fail + compile-fail)`, with `skip`
outside the denominator so nothing impossible is charged against the compiler.

### What is legitimately out of scope

An ahead-of-time compiler has no interpreter in the produced binary, so an
`eval()` or `new Function()` whose source is only known at run time cannot be
evaluated — nor can a runtime-computed dynamic `import()`. Perry compiles those
to a site that throws a recognisable sentinel, and the runner buckets them
`skip`. That is a deliberate WONTFIX: closing it would mean embedding a
JavaScript interpreter, which is the thing an AOT compiler exists not to do.

The same applies to `$262.createRealm`, `detachArrayBuffer` and the agent API,
which neither bare runtime provides — a case needing one would throw under
*both*, and counting that as agreement would be a false pass.

## Where this compiler stands: the mechanism fits, the compiler does not

The protocol needs nothing new from us. `nts_thrown` already calls `abort()`, so
a failed assertion exits non-zero, which is the whole signal. No Node-API addon
is required, no test is edited, and no type annotation is added to one.

**But we cannot run it yet, and the blocker is larger than the harness.**

test262 is *untyped JavaScript*, and this compiler requires types. Not exotic
types — any types at all. The smallest possible case:

```js
function SwitchTest(value) {   // value is `any`
  var result = 0;
  if (value === 0) { result += 2; }
  return result;
}
```

is refused with *a parameter of unrepresentable type (any)*, and its caller is
refused with it. That is every test262 file, for the same reason, before any
question of `switch` or `assert.js` arises.

So running the suite today would produce **one bug reported fifty thousand
times**, which is not a measurement. An earlier version of this section said the
refusal count would be a useful per-directory conformance signal; that is only
true once cases start failing for *different* reasons.

### What would have to change first

`any` is refused by design for application code, and rightly — `docs/any-unknown.md`
is explicit that none may reach MIR. What test262 needs is the neighbouring
capability that document also describes for `unknown`: a representation chosen by
**whole-program analysis** rather than by an annotation — a primitive, a managed
reference, a closed union, or a general erased value, whichever is cheapest
across all reachable uses.

That is a real feature and a large one. It is also the same feature that would
let this compiler accept ordinary JavaScript at all, so its value is not confined
to a test suite.

Until it exists, the honest position is:

- **the technique is settled and written down**, and costs nothing to keep;
- **test262's usable slice for us stays the expression harvest below**, which is
  small but real and has already caught a bug;
- **the language half is tested by TypeScript we write ourselves**, compiled and
  compared against node by `nts check`. test262 is worth *reading* for which edge
  cases to write.

Anyone who proposes "just run test262" should be shown the five-line function
above first.

## What is in the repository

| | files |
| --- | ---: |
| `test/language/expressions` | 11,164 |
| `test/language/statements` | 9,350 |
| `test/built-ins/Object` | 3,411 |
| `test/built-ins/Array` | 3,082 |
| `test/built-ins/TypedArray` | 1,446 |
| `test/built-ins/String` | 1,223 |
| `test/built-ins/Promise` | 732 |
| `test/built-ins/Set`, `Map` | 383, 204 |
| `test/built-ins/Number`, `Math` | 340, 327 |
| `test/built-ins/JSON` | 165 |
| all tests | 53,872 |
| negative tests (rejection is the correct answer) | 4,729 |

- **`harness/`** — `assert.js` 184 lines, `sta.js` 28, `propertyHelper.js` 510.
- **`INTERPRETING.md`** — the frontmatter specification: every test declares
  `includes`, `flags`, `features` and `negative`, which is what makes the suite
  filterable at all.
- **`features.txt`** — 196 named features. Perry curates a 98-line
  allow-list from it; there is no flag for `switch` or `for`, which are ES1.

## The expression harvest we do today

`tooling/suite/src/test262.rs` takes closed expressions out of tests and compares
them against node — 121 of them. It found `Math.round` wrong near 2^53, in the
folder and the runtime both, so it has earned its place.

It stays useful *alongside* the runner above, because it tests something the
runner does not: an expression made entirely of literals is computed by
`hir::fold` at **compile time**, so what it compares is the constant folder
against node's run time.

Two defects in it, found by reading it:

- **It is narrower than the compiler.** Seven `Math` members are allowed where
  eight are supported: `Math.sqrt` has ten test files and every one is skipped
  for no reason.
- **Everything it takes folds.** Substituting one operand for a parameter would
  exercise the runtime helper as well, from the same harvested expression.

## What to do, in order

1. **Fix the expression extractor's allow-list**, which is hours and pure gain
   against a mechanism that already works.
2. **Do not build the runner yet.** It would report one bug fifty thousand times.
   The design above is the deliverable for now; it costs nothing to hold.
3. **When representation inference for untyped code exists** — the `unknown` work
   in `docs/any-unknown.md` — build the runner that week. It is a script, and the
   hard thinking is already done.
4. Object-literal methods are worth fixing regardless: they are a *silent* defect
   today, and `assert.js` needs them the moment step 3 lands.
