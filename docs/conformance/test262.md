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

## Where this compiler stands

The mechanism needs nothing new from us. In particular:

- **`throw` already produces the right signal.** `nts_thrown` prints the message
  and calls `abort()`, so a failed assertion exits non-zero, which is exactly
  what the protocol reads.
- **No Node-API addon is required.** The addon is the right answer for embedding
  a compiled module in node; it is not needed here.
- **No test is modified**, and no type annotations are added to one. A
  conformance suite you edit is a suite you have agreed with.

What stands in the way is only our own language coverage, and it stands in the
way *at the harness*: to compile a case we must first compile `sta.js` and
`assert.js`. `assert.js` is 184 lines and needs a function carrying properties
(`assert.sameValue = …`), `throw`, string building and `typeof`. Object-literal
methods are a known silent gap, so today almost everything would bucket as
`compile-fail`.

**That is the measurement, not a reason to postpone it.** `compile-fail` counted
per directory *is* the conformance gap, and it ratchets: every feature added
moves cases out of that bucket without anyone maintaining a list. It is the same
instrument as the tsgo corpus, pointed at the language rather than at the
typechecker.

One shortcut is available and worth considering: the signal is only the exit
code, so our harness does not have to build a nice failure message — it only has
to throw. A minimal `assert` written in TypeScript, used by **both** sides, would
be far smaller than 184 lines. It would still have to be one object with
`sameValue`, `notSameValue`, `throws` and the rest hanging off it, which is
precisely the object-literal-method gap.

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

1. **Build the runner.** Assemble, run both sides, bucket by agreement, report
   per directory. It is a script, and the design is settled — the hard thinking
   is done and written down above.
2. **Take the first number**, however bad, and check it is bad for the reason we
   expect: `compile-fail` at the harness.
3. **Make the harness compile.** Object-literal methods, which are a known silent
   defect anyway. This single change is what converts the whole suite from
   unusable to a ratchet.
4. **Fix the expression extractor's allow-list**, which is hours and pure gain.
