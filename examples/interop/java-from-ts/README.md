# `java-from-ts` — TypeScript consuming Java

Read `types/com.example.d.ts` first, then `src/main.ts`, then `src/refused.ts`.
The Java under `java/` is deliberately awkward: every row of this project's
column in the coverage matrix appears in it, so the declarations beside it are a
real artefact rather than a sketch of a pleasant case.

**The `.d.ts` is GENERATED**, as of the `bind` example existing. `./build.sh`
compiles the Java, runs the generator over the resulting class files, and diffs
the output against what is committed; `NTS_REGENERATE=1 ./build.sh` accepts a
change.

It began as a hand-written specification for the generator. Keeping both would
be two answers to one question -- and the generator corrected the hand-written
version twice. First over `find(key: int)`, which the spec omitted as
"unreachable": it is reachable, and the generator emits every overload. Then
over *how* -- the spec reached it with a branded `int`, and brands were measured
and refused at every position a binding emits one, so the generator renames
instead and it is `find$int`.

## What to look at

| in `main.ts` | the decision it shows |
| --- | --- |
| `catalog.hits = 3` | a Java public field, a plain `putfield`, not one of our field ops |
| `Catalog.MAX` vs `Catalog.DEFAULT_KIND` | a `ConstantValue` static inlines to `ldc`; a reference static is a real `getstatic` that runs `<clinit>` |
| `index()`, `names()` | the Java collection itself, no copy, no wrapper |
| `counts()` returning `Int32Array` | cost 10a: the element type **is** the TypeScript type, so the loop is integer arithmetic |
| `bytes().subarray(0, 4)` | a view, not a copy |
| `catalog.id()` being `bigint` | 2^53+1 does not fit a `number`, and `id + total` refusing to compile is the point |
| `find(1.5)` vs `find$int(3)` | `number` is an f64, so `find(double)` is the only lossless receiver and keeps the plain name; the truncating one is reachable under a different **name**, because a branded `int` does not lower in a class method's parameter |
| `render("x")` | two equally lossless candidates, decided by JLS 15.12.2, the rule `javac` already runs |
| `describe(...)` vs `name()` | `@Nullable` read from the **CLASS-retention** table; `name()` cleaned up by the overrides file |
| `cursorAt(2)` | an inner class, constructed through the outer instance |

## One thing here is measured rather than claimed

The plan first said inner classes should be refused, then corrected that to
"deferred on priority, not difficulty". `javap` on the built jar settles it:

```
public final class com.example.Catalog$Cursor {
  public int at;
  final com.example.Catalog this$0;
  public com.example.Catalog$Cursor(com.example.Catalog, int);
```

The outer instance **is** the synthetic first constructor parameter, and
`this$0` is the capture — both readable by the class-file reader this lane is
building anyway. So `outer.newInner(n)` passing `this` first is not a
workaround, it is what `javac` emits for `outer.new Cursor(n)`.

## Why it is not at `examples/<name>/`

`backend_examples` globs `examples/*/tsconfig.json`, one level deep, and the
`jvm` floor is `exact` — it fails on `passed != total`. A project nested one
level further is invisible to it, so these can be read and iterated on without
turning the gate red for the other two sessions. They get surfaced deliberately,
with the floor moved in the same commit, once they compile.

## What running it exposed

Both of these were invisible until the generator ran on real class files, and
both produced output that **would not compile**:

- **A method's own type parameters were used but not declared.** `repeat` came
  out as `repeat(a0: T, ...)`, where `T` refers to nothing. The `<...>` block at
  the head of a generic signature is now read and rendered.
- **A sibling class was fully qualified.** `DEFAULT_KIND: com.example.Kind`
  inside `declare module "java:com.example"` refers to a `com` namespace that
  does not exist -- the module's own members are in scope unqualified.

- **Nested classes were emitted top-level.** `cursorAt` returns
  `Catalog.Cursor`, while `Cursor` was declared beside `Catalog` rather than
  inside it. They now go in an `export namespace Catalog` after the class, which
  is the order TypeScript wants for a declaration merge.
