# Proposals

Tested patches this lane wrote against files it does not own, kept here because
a patch that lives only in `/tmp` is a patch that is one `df` away from gone —
and that tmpfs has filled before, taking work with it.

Nothing here is applied. Each one is a proposal for the owner of the files it
touches, and the owner may rewrite it rather than take it.

## `foreign-calls.patch`

**TypeScript calling Java, lowered to real bytecode and verified.** Applies to
`e4fe0bb1`; 386 insertions across 8 files.

```
$ java -Xverify:all -cp classes:out:nts-runtime.jar Driver
TypeScript called Java: Box(14).size() * 1.0 = 42.0
and the answer is the one Java computes.
```

From a real compiled `com.probe.Box`, bound with `tooling/jvm/bind.sh`:

```
public static double main(com.probe.Box);
   0: aload_0
   1: invokevirtual #12   // Method com/probe/Box.size:()I
   4: i2d
   7: dreturn
```

### What it changes, and whose

**`compiler/core/src/hir/**` and `tooling/cli` — 271 insertions, not this
lane's:**

- `hir::runtime` gains `ForeignCall { key, kind }` and `ForeignKind`, beside
  `foreign_keeps`.
- `Options.foreign` keyed `(source, span end)` and **`Program.foreign` keyed by
  the foreign key**. On `Program` for the reason `classes` is: a backend turning
  `Callee::External` into an instruction needs the invoke kind, and
  `emit(&Program)` is its whole input.

  The two keys are deliberate. `lower` has a resolved declaration and needs its
  key; a backend has `Callee::External(key)` and nothing else. One loaded set,
  re-keyed as lowering finishes, each side indexed the way it asks. The first
  version kept one map and made the backend scan it — O(rows) per call site
  against **78,948 rows** for a bound Android SDK, which is ~10^8 string
  comparisons over a few thousand calls. Invisible on a nine-class fixture and
  unusable on a real jar; caught in review by the owner of the files.
- `FuncBuilder::new` splits into `probe` and `new`. 17 of 19 construction sites
  are probes that cannot reach a foreign call and get no table.
- **`members_of` filters bound members out**, rather than `method_body`
  refusing them. `Ok(None)` there still emits a function, and Java overloads
  collapse onto one HIR name — `DuplicateFunction { name: "Catalog#find" }`,
  three times over. A bound member is not a function missing a body; it is not
  a function of ours at all.
- `callee_for` returns `Callee::External(row.key)`, selected through
  `snapshot.call_targets`, which carries the declaration **after overload
  resolution**. That is what selects among overloads: 4,973 of 52,171 member
  names in a generated Android SDK binding carry more than one, and 1,870
  overload sets have two members at the same arity, so neither the name nor the
  arity is enough.
- `layout_of` names a bound class by its **binary name**, taken from the table's
  key rather than derived from the module specifier — so `java:` stays only in
  `bind.rs`. `nominal_name` already treated a name with a `/` as foreign; the
  family existed and only the name was missing. A foreign class takes no
  instantiation suffix: its binary name is what the jar calls it.

**`compiler/codegen/jvm` — 115 insertions, this lane's:**

- `ops.rs` decodes a foreign key and emits the invoke the row names, refusing
  rather than guessing when a row is missing: `invokevirtual` on an interface is
  an `IncompatibleClassChangeError` at link time, in the user's program.
- `types::class_name` stops renaming a foreign class. `com/probe/Box` under
  `nts/gen/` with its slashes flattened is `nts/gen/com$probe$Box`, a class
  nobody has.

**This lane's half cannot land alone** — it reads `Program.foreign`, so it does
not compile without the other. One proposal or none.

### Two things the build taught that reading had not

- **The receiver is `args[0]` and the descriptor does not mention it.** HIR
  gives a foreign instance call the runtime-helper shape; `push_arguments` walks
  the descriptor, which declares only the rest. Pushing all of `args` left the
  stack one short — `moved the operand stack from 0 to -1`, caught by the
  emitter's own accounting.
- **Java's width is not TypeScript's.** `int size()` returns `I` and a `number`
  is a `double`: one word where two were wanted, the same error from the other
  direction. Hence the `i2d`.

### What it does not do

`escape.rs`'s `Callee::External` arm still does not take a `keeps` answer from
the table, and `Facts` is still not seeded from a JVM descriptor. Both are named
in the same plan and neither is touched here.
