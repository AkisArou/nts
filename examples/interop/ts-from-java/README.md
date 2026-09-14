# `ts-from-java` — Java consuming TypeScript

**This one compiles and runs today.** `./build.sh` emits the TypeScript, checks
the published API against `expected/Api.javap`, compiles `java/Main.java`
against it, and runs it under `-Xverify:all`. It prints:

```
hello java 1.0 2.0 2.0 6.0
```

So unlike `java-from-ts`, nothing here is a specification. It is what the
compiler does now.

## Item 0, proven by `javac` rather than asserted

The published class is:

```
public final class nts.gen.Session {
  double $hits;
  public nts.gen.Session();
}
```

`double $hits` with **no `public`**. Uncommenting the `s.$hits` line in
`Main.java` gives:

```
error: $hits is not public in Session; cannot be accessed from outside package
```

That is the whole of item 0 working, checked by a third-party tool. A Java
caller that wants to mutate has to go through `Session$bump`, whose store is a
`FieldSet` **in the HIR** — which is exactly what `hir::fields` needs for its
narrowing to stay sound.

`expected/Api.javap` is checked in and diffed on every run, so the day a
generated field goes back to `public` the build says so out loud with the line
in the diff. Sabotaging that file makes the build fail, which is how it was
checked.

## The finding: it works, and the DX is poor

Read `java/Main.java`. A Java caller writes:

```java
nts.gen.Session s = new nts.gen.Session();
double n = nts.gen.Program.Session$bump(s);
```

not `s.bump()`. **Every TypeScript method is emitted as a static on `Program`
that takes the receiver as its first argument**, because `Callee::Direct` lowers
to `invokestatic` — "fewer instance methods is faster and simpler", which is
right for our own call sites and is what it costs a Java caller.

Two other things a Java caller sees:

- **Every `number` is a `double`.** `hits()` returns `2.0`, not `2`. The route
  this row once pointed at is closed: narrowing to `int` was to come from the
  brand, and brands were measured and **refused** at every position a binding
  emits one. What would narrow it is a descriptor-level fact about the exported
  signature, which is the `Facts::from_jvm_descriptor` patch's other direction
  and is not built.
- **`number[]` is `double[]`**, passed with no copy and no wrapper, which is
  the part that is already right.

### Proposed fix, and it is cheap

Emit a **Java-facing facade** for exported classes: an instance method per
exported method that forwards to the static.

```java
public final class Session {
  double $hits;
  public double bump() { return Program.Session$bump(this); }
  public double hits() { return Program.Session$hits(this); }
}
```

Three instructions each (`aload_0`, `invokestatic`, `dreturn`), inlined to
nothing by C2 and by ART. Our own call sites keep using `invokestatic` directly
and lose no speed; the Java caller gets `s.bump()`. The facade exists only on
classes the program exports, so nothing internal grows.

**This is worth your feedback before it is built** — the alternative is to leave
the surface as-is and document it, which is honest but unpleasant, and there is
no compatibility reason to prefer either.

## The Map boundary, demonstrated rather than argued

`tags(): Map<string, string>` in the TypeScript is held by Java as a
`java.util.Map<Object, Object>` — **the same object**, backed by the same arrays
the compiled code wrote. The run prints:

```
| session 2 [kind state] live=true svz=positive zero
```

Four claims, each of which a copy would break:

| | |
| --- | --- |
| `session 2` | the map is readable from Java at all |
| `[kind state]` | **insertion order survives** — a `HashMap` would not give this |
| `live=true` | a `put` through the Java interface is visible to the TypeScript side, so there is **one table and no copy** |
| `svz=positive zero` | Java looks up `-0.0` and finds what TypeScript stored as `0` |

The last is the reason this table is not a `LinkedHashMap`. JS keys by
SameValueZero: `NaN` matches `NaN` and `+0` matches `-0`. `Double.equals`
agrees on the first and disagrees on the second — and normalising `-0` to `+0`
at insert, which the table already did so iteration exposes `+0`, makes the two
rules coincide on every input.

`live=true` is the load-bearing one. Every other assertion here passes just as
well against a copy.

## The Map boundary is asymmetric, and that is worth knowing before you design against it

A `Map` crossing **out** is free. `NtsMap implements java.util.Map`, so the
reference Java receives IS the table, and the section above proves it by writing
through the Java interface and seeing the TypeScript side change.

A `Map` crossing **in** is not. A `Map` parameter publishes as the concrete
`nts.rt.NtsMap`, not as `java.util.Map`:

    public static double countOf(nts.rt.NtsMap);

so a caller holding a `HashMap` cannot pass it. There is no `NtsMap.fromMap`;
the supported route is `newMap` and then `set` per entry, through `NtsValue`.
That is a copy, and it is O(n) on every call rather than once.

Widening the parameter to `java.util.Map` would let any map in, and would cost
the thing that makes the outward direction worth having: the body would be
dispatching through an interface to a table it no longer owns the layout of.
Both directions cheap is a real design question, not an oversight to patch.

## What is not here yet

Closures as Java lambdas, and generics across the boundary -- `tags()` publishes
a **raw** `NtsMap`, which is why `Main.java` casts every value it reads out.
