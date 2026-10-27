**Fuzzilli does not natively fuzz TypeScript programs**. Its output target is JavaScript, although internally it already has a lightweight type system specifically to make generated programs semantically meaningful. ([GitHub][1])

I also don't see a mature, actively maintained **“Fuzzilli but for TypeScript”** that I'd recommend as a drop-in replacement. For your compiler, I'd choose between these approaches:

| Approach                             | Best for                        | My take                    |
| ------------------------------------ | ------------------------------- | -------------------------- |
| **Modify Fuzzilli**                  | native backend / optimizer bugs | ⭐ Probably best long-term |
| **fast-check + typed AST generator** | actual TS types + codegen       | ⭐ Best to build quickly   |
| **Grammarinator + TS grammar**       | parser/frontend crashes         | Useful, but not type-aware |
| AFL++ / libFuzzer raw input          | parser robustness               | Supplemental               |

### 1. I would seriously consider adapting Fuzzilli

There's an important detail: Fuzzilli already tracks things like `integer`, `float`, `number`, `string`, `boolean`, function signatures, objects, iterables, etc. Its generators use these types when choosing operands. ([GitHub][2])

So instead of:

```text
FuzzIL
   ↓
JavaScriptLifter
   ↓
foo.js
```

you could build:

```text
FuzzIL
   ↓
TypeScriptLifter
   ↓
foo.ts
   ↓
your compiler
   ↓
native binary
```

For example, FuzzIL might effectively represent:

```text
v0 = 42
v1 = 13
v2 = v0 + v1
```

Its normal lifter produces roughly:

```js
const v0 = 42;
const v1 = 13;
const v2 = v0 + v1;
```

Your lifter could emit:

```ts
const v0: number = 42;
const v1: number = 13;
const v2: number = v0 + v1;
```

You would keep a huge amount of Fuzzilli infrastructure for free:

- coverage-guided corpus management
- mutation
- splicing
- minimization
- interesting-input selection
- type-informed variable selection
- code generation templates

Fuzzilli's architecture explicitly separates the **Lifter**, **Environment**, generators, mutators, runner, evaluator and minimizer, so it's reasonably suited to this kind of experimentation. ([GitHub][1])

[Fuzzilli repository](https://github.com/googleprojectzero/fuzzilli?utm_source=chatgpt.com)

There is one big caveat: Fuzzilli's types are **runtime JS categories**, not TypeScript's type system.

It doesn't inherently understand:

```ts
number | null

{ x: number; y: string }

T extends Foo

keyof T

A & B

readonly number[]

(x: number) => string

{ kind: "foo"; x: number } |
{ kind: "bar"; y: string }
```

So this route is fantastic if the thing you're mainly testing is:

```text
TS frontend
    ↓
IR
    ↓
optimizer
    ↓
native codegen
```

but less ideal if you specifically want to torture your TypeScript type checker.

---

### 2. For real type-aware TS fuzzing, I'd use `fast-check`

This is probably what I'd start with.

`fast-check` is a mature TypeScript property-testing/generative-testing library with deterministic seeds and built-in shrinking. ([Fast Check][3])

[fast-check](https://github.com/dubzzz/fast-check?utm_source=chatgpt.com)

Don't have it generate strings. Have it generate **your own typed IR/AST**:

```ts
type Ty =
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "string" }
  | { kind: "array"; element: Ty }
  | { kind: "object"; fields: Record<string, Ty> };

type Expr<T extends Ty = Ty> = LiteralExpr<T> | VariableExpr<T> | BinaryExpr<T> | CallExpr<T>;
```

Then the core API becomes something like:

```ts
function exprOf(type: Type, env: Environment, depth: number): fc.Arbitrary<Expr>;
```

So when you need a `number`, you generate only expressions whose static type is `number`:

```ts
function numberExpr(env: Env, depth: number): fc.Arbitrary<Expr> {
  return fc.oneof(
    numberLiteral(),
    numberVariable(env),

    fc.tuple(numberExpr(env, depth - 1), numberExpr(env, depth - 1)).map(([a, b]) => ({
      kind: "binary",
      op: "+",
      left: a,
      right: b,
      type: numberType,
    })),
  );
}
```

Then print:

```ts
function foo(a: number, b: number): number {
  let x: number = a + b;

  if (x > 10) {
    x = x * 2;
  }

  return x;
}

console.log(foo(7, 9));
```

And your property is basically:

```ts
fc.assert(
  fc.property(programArbitrary, (program) => {
    const source = print(program);

    const reference = runUsingJSReference(source);
    const native = compileAndRun(source);

    assert.deepEqual(native, reference);
  }),
);
```

The particularly attractive part here is **shrinking**. `fast-check` automatically shrinks generated counterexamples, though for compiler ASTs you'll eventually want some custom shrinking rules too. ([Fast Check][4])

---

### 3. Grammarinator is interesting for your parser

If your goal is:

> “Throw enormous amounts of syntactically valid TypeScript at my frontend and see what crashes.”

then **Grammarinator** is worth looking at.

It takes an ANTLR grammar and generates/mutates grammar-valid inputs, and it can integrate with AFL++ and libFuzzer. ([GitHub][5])

[Grammarinator](https://github.com/renatahodovan/grammarinator?utm_source=chatgpt.com)

And ANTLR's grammar collection includes a TypeScript grammar under its JavaScript/TypeScript grammars. ([GitHub][6])

Architecture:

```text
TypeScript grammar
       ↓
 Grammarinator
       ↓
random syntactically-valid .ts
       ↓
your compiler
```

The problem is that grammar validity ≠ type validity.

It can easily produce:

```ts
function x(a: string): number {
  return a + false;
}
```

or bizarre combinations that parse correctly but get rejected long before reaching native codegen.

So I would use Grammarinator specifically for:

```text
lexer
parser
AST construction
diagnostics
error recovery
```

rather than serious optimizer/codegen testing.

---

### There's also a surprisingly easy Fuzzilli experiment

Since **TypeScript is a syntactic superset of JavaScript**, you can first try feeding ordinary Fuzzilli-generated JS directly into your compiler as `.ts`.

```text
Fuzzilli
   ↓
test.js

rename / feed as

test.ts
   ↓
your compiler
```

Filter out programs your TS frontend rejects.

This won't test things like:

```ts
interface
type
enum
generics
unions
annotations
```

but it could immediately start finding bugs in:

```text
closures
arrays
objects
control flow
SSA
arithmetic
calls
loops
exceptions
optimizer
native codegen
```

You'd probably want to disable Fuzzilli generators for JS-engine-specific builtins/intrinsics that your runtime doesn't implement.

### What I'd build for your project

I'd actually combine **Fuzzilli + a small custom TS generator**, rather than search much longer for an existing TS-specific fuzzer.

Something like:

```text
                     ┌─────────────────┐
                     │ typed TS seeds  │
                     └────────┬────────┘
                              │
                         TS AST mutator
                              │
                              ▼
┌─────────────┐        ┌───────────────┐
│  Fuzzilli   │───────►│  TS programs  │
│ mutations   │        └───────┬───────┘
└─────────────┘                │
                    ┌──────────┴──────────┐
                    ▼                     ▼
             reference execution     your compiler
                    │                     │
                    │                 native binary
                    │                     │
                    └──────────┬──────────┘
                               ▼
                           compare
                               │
                        coverage + corpus
```

And I'd separate fuzzing into two modes:

```text
frontend-fuzz:
    Grammarinator / malformed TS
    oracle = compiler must not crash

codegen-fuzz:
    strictly well-typed TS
    oracle = Node/reference result == native result
```

The **second one is the important one for your compiler**.

If I were implementing this compiler myself, I'd probably start with **fast-check for the typed generator**, get differential execution working, and later steal/adapt Fuzzilli's coverage/corpus/mutation ideas. Fuzzilli is powerful enough that a custom `TypeScriptLifter` may eventually be worth the effort, especially once you have optimizations to attack.

[1]: https://github.com/googleprojectzero/fuzzilli?utm_source=chatgpt.com "GitHub - googleprojectzero/fuzzilli: A JavaScript Engine Fuzzer · GitHub"
[2]: https://github.com/googleprojectzero/fuzzilli/blob/main/Sources/Fuzzilli/FuzzIL/TypeSystem.swift?utm_source=chatgpt.com "fuzzilli/Sources/Fuzzilli/FuzzIL/TypeSystem.swift at main · googleprojectzero/fuzzilli · GitHub"
[3]: https://fast-check.dev/docs/introduction/what-is-property-based-testing/?utm_source=chatgpt.com "What is Property-Based Testing? | fast-check"
[4]: https://fast-check.dev/docs/introduction/getting-started/?utm_source=chatgpt.com "Getting Started | fast-check"
[5]: https://github.com/renatahodovan/grammarinator?utm_source=chatgpt.com "GitHub - renatahodovan/grammarinator: ANTLR v4 grammar-based test generator · GitHub"
[6]: https://github.com/antlr/grammars-v4/issues/2535?utm_source=chatgpt.com "Missing license or copyright · Issue #2535 · antlr/grammars-v4 · GitHub"
