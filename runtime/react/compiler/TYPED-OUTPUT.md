# React Compiler output as typed TypeScript

**The question.** The upstream Rust React Compiler rewrites each component,
and nts refuses what it cannot type. Can the compiled code stay correct,
compilable TypeScript with the precision of the original? What is the
cheapest way to get there that stays correct?

**Answer: yes, without writing our own codegen.** Run upstream's compiler
unchanged. Then restore types on its output, matching each output node to the
original source by its span. A restored program is accepted only if tsgo
accepts it with no binding looser than in the original. Any function that
fails this stays uncompiled.

Measured on 225 compiled upstream fixtures plus 40 of our own, all
verified by running them (the study is described at the end):

| Output | Upstream TS fixtures whose original typechecks (69) | Construct sweep (40) |
| --- | --- | --- |
| upstream, cache typed `any[]` (as `react/compiler-runtime` ships) | 20 typecheck, but 65 of 69 gain `any` bindings | |
| upstream, cache typed `unknown[]` (as our runtime has it) | 16 | |
| restored, function outlining on | 65 | 38 |
| **restored, function outlining off** | **66** | **40** |

In the last row, the three remaining corpus failures are:
- two cases where the only new loose binding is the `any` already written in
  `@types/react`'s component signature;
- one case of assignment narrowing, described below.

**Runtime behaviour is unchanged.** Every restoration is type-only. With the
types stripped and both sides printed by the same printer, all 265 restored
outputs are identical JavaScript to upstream's output. The control arm
(outputs compiled with outlining on) differs in 8 files, so the check can
fail.

This changes step 5 of the plan in AUDIT.md. That plan re-ran upstream's
passes up to the `ReactiveFunction` and did typed codegen of our own. The
restoring design needs neither:
- we don't copy the roughly 60 pass calls (AUDIT.md risk 2);
- we have no codegen to maintain;
- parity with upstream holds by construction, because the output *is*
  upstream's.

## Why upstream's output is untyped

Every memoized value goes through the cache:

```ts
let t1;
if ($[0] !== count) { t1 = () => setCount(count + 1); $[0] = count; $[1] = t1; }
else { t1 = $[1]; }
```

TypeScript types an unannotated `let` from its assignments, and one of them is
always a cache read. With the shipped `any[]` cache, every memoized
temporary becomes `any`. That `any` then spreads to the named locals that
read it (`const onClick = t1`). 65 of the 69 outputs gain such bindings, while
20 still "typecheck". So for this code, "it typechecks" is the wrong bar. nts
refuses `any`, and it would pay a checked downcast for every `unknown`.

Separately, codegen drops type syntax. The sweep
(`fixtures/typed-output/`, one component per construct) shows the pattern:
- type syntax that is part of an expression passes through (`as`, `enum`);
- type syntax attached to a declaration or a call is dropped.

| Construct | What upstream emits |
| --- | --- |
| parameter annotations | dropped when the parameter is renamed (`t0`) or outlined (`_temp`); `?` is lost |
| `const x: T = …`, `let x: T` | the annotation is dropped |
| `let x!: T` | the definite `!` is dropped |
| function type parameters `<T>` | dropped on components, hooks and nested functions |
| return types, type predicates `x is T` | dropped, so `filter` no longer narrows |
| call and `new` type arguments, `?.<T>()` | dropped: `useState<Item \| null>(null)` becomes `useState(null)` |
| instantiation expressions `f<T>` | dropped |
| non-null assertions `x!` | dropped |
| local `type` and `interface` in a function body | dropped |
| `as const`, `satisfies` on a memoized literal | detached: `const pair = t0 as const`, **which is invalid TypeScript** (TS1355) |

## The restoration

There are two kinds of rules, and the difference matters.

**1. What the user wrote is restored verbatim.** Parameter, local and
return annotations, type parameters, type arguments, `!`, the definite
`!`, `?` and local type declarations are copied as source text. They come
from the original node whose span matches the output node:
- no type is printed, so nothing can fail to be nameable;
- the user's own spelling survives.

**2. What the compiler introduced gets the checker's type.** Temporaries
(`let t1`), renamed parameters with no annotation, and temporaries for
default values are annotated with the type tsgo gives the original
expression at their span, printed at that position. Cache reads become
`t1 = $[1] as typeof t1`. That is the stopgap until the cache is typed (see
Next steps).

**Span matching.** Upstream's output nodes carry the original `loc`, with
start and end. That includes:
- temporaries (a temporary's span is the expression it holds);
- renamed parameters (the span is the whole original parameter);
- the operand of a dropped `x!` or `f<T>`.

Two conventions differ between Babel and TypeScript, and the index handles
both:
- Babel starts a declaration after `export`;
- Babel's identifier span includes its annotation (`x!: number`).

**Validation, then fallback.** The restored function is checked by tsgo.
It is accepted only if:
- there is no new diagnostic;
- no binding is `any` or `unknown` where the original's was not.

Otherwise the function is emitted as the user wrote it. It is still correct,
just not memoized, and the fallback count is reported.

## Limits found

- **Assignment narrowing.** In
  `let x: HasA | HasC = shallowCopy({kind: 'hasA', …})`, the original
  narrows `x` to `HasA` on assignment. The call moves into a temporary, whose
  checker type under the contextual union is `HasA | HasC`, and the narrowing
  is gone. A type printed for a sub-expression can be wider than what the
  original code observed. It is 1 of 69 in the corpus, and validation
  catches it.
- **Function outlining.** Outlining moves callbacks to module scope as
  `_temp`, where local types and type parameters are not in scope. It
  accounts for every failure that is present with outlining on and absent with
  it off. We compile with `enableFunctionOutlining: false`, as AUDIT.md
  already recommended. The cost is that a callback without captures is
  memoized in place instead of being hoisted.
- **Printing.** The prototype prints with TypeScript's `typeToString`, and
  printed JSX types came out as `import("/abs/path/jsx-runtime").JSX.Element`.
  That is valid, but the production pass must print module specifiers the way
  declaration emit does. A type that can't be named (`__type`, truncation)
  sends the function to fallback.

## What nts needs

- **tsgo already exposes `typeToString` and `typeToTypeNode`** with an
  enclosing declaration and flags (`third_party/typescript-go/internal/api/session.go`).
  `compiler/frontend-ts` doesn't call them yet (`tsgo/proto.rs`), so adding
  them is a request to the compiler lane, and a batched variant would be
  worth asking for. The lane itself edits nothing in `compiler/`.
- **`react/compiler-runtime` has to type `c`.** `@types/react` exports
  nothing from it, so upstream's own output doesn't typecheck against the
  official types. Our runtime declares it.

## Next steps

1. **A typed cache**, to remove the `unknown` reads. After restoration, every
   `$[k] = v` stores a value whose type is known: an annotated temporary, a
   declared local, or a dependency expression at its span. So the cache's
   slot types can be derived from the output:

   ```ts
   const $ = useMemoCache<[number, () => void, …]>(N)
   ```

   That is a tuple local to the function, where its type parameters and local
   types are in scope. Reads then need no cast. Upstream's sentinel test
   (`$[k] === Symbol.for("react.memo_cache_sentinel")`) doesn't typecheck
   against a typed slot, so it becomes a filled-bit test in our runtime. For
   nts, this is the fixed-layout record the lane's route calls for. Not built
   yet.
2. **Port the restoration to Rust**, as a lane-owned crate that works on
   `react_compiler_ast` output and asks tsgo for types at spans in batches.
   `fixtures/typed-output/` is its regression corpus, and each fixture must
   come out clean with its JavaScript unchanged.
3. **The frontend** is unchanged from AUDIT.md: a tsgo → `react_compiler_ast`
   converter, or Babel in node until one exists.

## Reproducing

`study/` holds the scripts this document's numbers come from. They are
measurement code, not the implementation.

1. Set up a workspace with `@babel/core`, `@babel/parser`,
   `@babel/generator`, `@babel/types`, `typescript@5.9` and `@types/react@19`.
2. Build upstream's napi addon:
   `cargo build --release -p react_compiler_napi` in the pinned checkout's
   `compiler/`, copied to
   `packages/babel-plugin-react-compiler-rust/native/index.node`.
3. Build that plugin with `tsc`.
4. Copy upstream's `packages/snap/src/sprout/shared-runtime.ts` into
   `study/stubs/`.

The scripts:
- `compile.cjs`: upstream output (`RC_MODE`, `RC_OUTLINE=0`);
- `retype.cjs`: the restoration;
- `measure.cjs`: one-program typecheck, with loose bindings per file;
- `same-js.cjs`: the JavaScript equality check;
- `gen.cjs`: writes the sweep.

The run used for this document was in `~/.cache/nts-react/rc-study`.
