# test262: what is in it, and how much of it we can use

The whole repository is checked out now — 53,872 tests, the harness, and the
metadata specification. It used to be a sparse checkout of three directories,
which meant the answer to "can we test this?" was often "the files aren't here",
which is a bad reason.

## Why it cannot be run as a suite

Every test expects a JavaScript engine. It needs `assert.js` and `sta.js`
evaluated first, an `Object.prototype` to hang things off, and often `eval`. The
first file in `language/expressions/compound-assignment` is:

```js
assert.throws(ReferenceError, function() { eval("_11_13_2_1 *= 1;"); });
```

Running that means being a JavaScript engine, which is the thing this project
exists not to ship. So the question is never "how do we run test262" — it is
"which parts of it can be turned into something we *can* run, and against what
oracle".

**The oracle is always node.** A test file's own expected value is discarded even
when it is available, because node is the engine and the file is only an
assertion about one. This also means a test's assertions are not needed at all —
only its *code*.

## What is in it

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
| everything else | the rest of 53,872 |

Also worth knowing about:

- **`harness/`** — `assert.js` is 184 lines, `sta.js` 28, `propertyHelper.js` 510.
  `assert.sameValue` throws a `Test262Error` built by string concatenation, so
  implementing it in TypeScript needs exceptions. A *stub* that records a boolean
  instead compiles today, and is all the comparison needs.
- **`INTERPRETING.md`** — the frontmatter specification, and the reason any of
  this can be filtered mechanically. Every test declares `includes`, `flags`,
  `features` and `negative`.
- **`features.txt`** — 196 named features. Less useful as a conformance checklist
  than it sounds: it covers proposals and ES6+ additions, so there is no flag for
  `switch` or `for`, which are ES1.

## The funnel

Filtering by the metadata alone — no `includes`, no `eval`, not a `negative`
test, not `async`, not `module`, and no prototype, `Proxy`, `Reflect`, `Symbol`,
`arguments` or `this`:

| | files |
| --- | ---: |
| all tests | 53,872 |
| **need no engine machinery** | **10,484** |
| …of which `language/expressions` | 2,786 |
| …`built-ins/Object` | 1,640 |
| …`language/statements` | 1,245 |
| …`built-ins/Math`, `Number`, `String` | 158, 119, 149 |

10,484 is the ceiling for "could conceivably be compiled". The real number is
lower, because those files are still *untyped JavaScript* — see the honest
blocker below.

Against that, what is used today: **121 expressions**.

## Three levels of leverage

### 1. Harvest expressions — what happens today

Take a closed expression out of a test, compile it, compare against node.
`Math.round(-0.5)`, `(-2147483648 | 0) >>> 0`. This is how `Math.round` near
2^53 was found wrong in the folder and the runtime both.

Narrow, and narrower than it needs to be. Two defects in our own extractor:

- **It is narrower than the compiler.** Seven `Math` members are allowed where
  eight are supported: `Math.sqrt` has ten test files and every one is skipped
  for no reason.
- **A closed expression folds.** `hir::fold` computes it at compile time, so what
  is compared is the *constant folder* against node — worth having, and not a
  test of the runtime helper beside it. Substituting one operand for a parameter
  would exercise both paths from the same harvested expression.

### 2. Harvest *functions*, and drive them with `nts check`

The limitation was never "only expressions" — it is that the extractor only
*takes* expressions. `nts check` already compiles a whole function, runs it
natively, runs the same source in node, and compares bit patterns.

So a test like `language/statements/switch/S12.11_A1_T1.js`:

```js
function SwitchTest(value) {
  var result = 0;
  switch (value) { case 0: result += 2; case 1: result += 4; break; /* … */ }
  return result;
}
```

is a plain function from a number to a number. Once `switch` exists, this
compiles and `nts check` drives it — and its assertions are not needed, because
node computes the expected answer.

This unlocks everything whose *signature* is scalar: control flow, classes,
closures, recursion.

### 3. Substitute our implementation into node — no edits to any test

This is the one that changes the shape of the problem, and it runs test262
**unmodified**.

`compiler/codegen/napi` compiles a program into a Node-API addon that node loads
and calls in process. So instead of trying to compile a test, replace the thing
the test is testing:

```js
const nts = require("./nts_math.node");
Math.round = nts.round;             // ours, compiled to native
// then run built-ins/Math/round/*.js exactly as written
```

node supplies everything we cannot — `assert.js`, `Object.prototype`, `eval`,
the error types, the whole object model. We supply one function. The test file
is untouched, which is the only way a conformance suite is worth anything: a
suite you edit is a suite you have agreed with.

**Editing tests to add type annotations, which an earlier draft of this document
proposed, is the wrong idea and is struck from it.** It would mean maintaining a
fork of 50,000 files, and every annotation is a claim about the test that the
test did not make.

#### What this covers

Anything that is a *substitutable value*:

| | tests | note |
| --- | ---: | --- |
| `built-ins/Math` | 327 | every member is a plain function |
| `built-ins/Number` | 340 | statics and `Number.prototype` |
| `built-ins/String` | 1,223 | `String.prototype` methods take a string and return one |
| `built-ins/Array` | 3,082 | needs array marshalling both ways |
| `built-ins/JSON`, `Map`, `Set` | 165, 204, 383 | objects and classes rather than functions — harder, still substitutable |
| `parseInt`, `parseFloat`, `isNaN`, `isFinite` | 139 | globals |

#### What it does not cover, and cannot

**Language semantics.** A test for `**`, `switch`, `for`, a class or a closure
exercises node's own parser and evaluator. There is nothing to substitute — you
cannot replace an operator or a statement with a function. Running
`language/expressions/exponentiation/*.js` against a patched global tests node's
`**`, not ours, however much of our compiler is loaded beside it.

So the 11,164 files under `language/expressions` and 9,350 under
`language/statements` — the two largest directories, and the ones covering most
of what this compiler is not done with — stay out of reach by this route.

**TypeScript.** Generics, interfaces, `keyof`, tagged unions. test262 is a
JavaScript suite; there is nothing there to run.

**Everything the compiler does rather than computes.** Substituting `Math.round`
tests our `Math.round`. It says nothing about loop specialization, escape
analysis, or reference counting, which is right — those are meant to be
invisible.

#### Two honest costs

- **Marshalling.** A JavaScript string has to become an `NtsString` and back on
  every call. That is the addon's job and it is correctness-neutral, but it means
  what is measured is our *semantics*, never our speed.
- **A share of the tests are not about behaviour.** They check a function's
  `length` and `name`, or its property descriptor: 37% of `Math`, 16% of `String`
  and `Array`, 14% of `Number`. A wrapper can set most of that deliberately, but
  a failure there is a fact about the wrapper rather than about the
  implementation, and counting them as conformance would be dishonest.

## What to do first, in order of value per hour

1. **Fix the extractor's allow-list** so it is not narrower than the compiler.
   Hours, pure gain, and `Math.sqrt`'s ten files stop being skipped for nothing.
2. **Parameterise one operand** of a harvested expression, so the runtime helper
   is tested and not only the constant folder.
3. **Substitution, starting with `Math`.** 327 tests, every member a plain
   `number -> number` function, no marshalling harder than a double. It is the
   smallest possible version of the whole mechanism, and if it works the same
   harness reaches `Number`, `parseInt`, then `String` and `Array`.
4. **Accept that the language half is ours to write.** Roughly 20,000 test262
   files cover operators and statements and none of them can be used. Knowing
   that is worth more than another attempt at making them fit.
