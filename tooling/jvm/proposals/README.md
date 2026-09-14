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

### `Facts` from the descriptor — the second of the plan's three one-liners

`facts::from_jvm_descriptor` existed, was documented, was tested, and **had no
caller outside its own tests**. Correct code that compiled, linked, and did
nothing. `flow.rs` now calls it for a `Callee::External` whose name is a foreign
key — and needs no table to do it, because the descriptor is already in the key.

**Measured rather than asserted.** Four probes, arms differing in that one line:

| probe | changed |
| --- | --- |
| `Math.abs(b.size())` | **yes** |
| `b.size() + b.size()` | no |
| `xs[b.size()]` | no |
| `b.size() < 10` | no |

```
without facts          with facts
  i2d                    istore_1        <- stays an int
  Math.abs:(D)D          i2l
                         Math.abs:(J)J   <- integer abs, not floating point
                         l2d
```

The three that did not change look right rather than broken: `int + int`
overflows so the sum must stay `f64`; an index in `[-2^31, 2^31-1]` is not
provably inside any array, so the bounds check has to stay. One probe in four is
the honest figure, and it would have been easy to run only the first and claim
the feature.

### The conversion policy, settled and verified — NOT yet in the patch

The defect below is diagnosed, the rule is decided, and the implementation was
written and verified and then **lost to a `/tmp` clear before it was committed**.
What follows is everything needed to redo it in an hour rather than a day.

**The rule is `ToInt32`, not `d2i`, not saturation.** Three camps exist across
languages and the split is principled: WebAssembly's JS API, asm.js, `ctypes`
and the LuaJIT FFI **wrap**, because the foreign `int` is the machine model the
source language already emulates; GraalVM host interop and Dart FFI **refuse**,
because two type systems are meeting; Java's own `d2i`, Kotlin's `toInt()` and
Rust's `as` **saturate** — and nobody picks saturation for a *language
boundary*. Three facts in this repository decide it independently of the survey:
node is the oracle and node wraps, `NtsRuntime` already implements exactly that
and documents it, and `hir::runtime` declares `nts_to_int32` as the single
answer about conversions.

**The mapping, one runtime helper per JVM width.** Java's `char` is unsigned and
its `byte` and `short` are not, so they do not share a helper:

| descriptor | Java | helper | node's analogue |
| --- | --- | --- | --- |
| `I` | `int`, signed 32 | `NtsRuntime.toInt32` | `Int32Array` |
| `S` | `short`, signed 16 | `toInt16` | `Int16Array` |
| `B` | `byte`, signed 8 | `toInt8` | `Int8Array` |
| `C` | `char`, **unsigned** 16 | `toUint16` | `Uint16Array` |
| `F` | `float` | `d2f` | `Float32Array` |

**Verified against node, which is the oracle.** Nine values through four
integral widths, run under `-Xverify:all` and diffed against the matching typed
array — **identical on all 36**:

```
-1          i=-1          s=-1  b=-1   c=65535
4294967295  i=-1          s=-1  b=-1   c=65535
2147483648  i=-2147483648 s=0   b=0    c=0
200         i=200         s=200 b=-56  c=200
70000       i=70000       s=4464 b=112 c=4464
1.9         i=1           s=1   b=1    c=1
-1.9        i=-1          s=-1  b=-1   c=65535
NaN         i=0           s=0   b=0    c=0
16777217    i=16777217    s=1   b=1    c=1     (float32: 16777216)
```

The last row is the `float32` case the native lane asked for, and
`4294967295` against `-1` is the `UINT32_MAX` one: identical for `int`,
*different* for `char`, which is what makes the unsigned distinction load-bearing
rather than cosmetic.

**Statics take a different path and also need wiring.** `S2.twice(x)` never
reaches `callee_for` — it has no receiver to dispatch on — and is built at
`lower.rs`'s `Callee::Direct(format!("{class_name}.{member_name}"))` site. The
same `call_targets` lookup goes there. Java's APIs are full of statics
(`Integer.parseInt`, `Math.abs`), so this is not an edge case. Verified working:
`invokestatic com/conv/S2.twice:(I)I` behind a `toInt32`, printing `42.0`.

**Clippy items the patch introduces**, all found by the gate's own
`cargo clippy --workspace --all-targets` and all fixed in the lost copy:

- a `FxHashMap` parameter fixes the hasher for every caller — a
  `pub type ForeignTable` in `hir::runtime` answers it everywhere;
- `lower_with` goes one line over, from a lone `foreign,` inserted into a
  multi-line `FuncBuilder::within` call — **clippy does not count comments**, so
  only code lines help;
- `ops.rs`'s `call` goes over; folding the foreign path and the
  no-row refusal into one `not_in_this_table` helper puts it under, and is
  better shaped anyway since both answer *is this name something we can call*;
- `tooling/bench` builds `hir::Options` without `..default()`, so the new field
  breaks it.

### A KNOWN DEFECT — do not apply this as-is

**A foreign call with an integral parameter does not emit.** Found by building
an interop benchmark, which is the first case with an argument:

```
declined: NTS4001 emitting %11 moved the operand stack from 0 to 1
          (in `sum`)     -- a.step(i), descriptor (I)I
```

`push_arguments` walks the descriptor and coerces callback interfaces, not
numeric widths, so a TypeScript `number` is pushed as a `double` where the
descriptor declares `I`. It is the exact mirror of the return-width bug already
fixed in this patch, on the argument side, and **every probe I wrote used a
zero-argument method**, so nothing caught it.

**The fix is not a `d2i`**, which is why it is not written here.
`runtime/jvm/src/nts/rt/NtsRuntime.java` says it out loud: *ToInt32 via
significand bits: truncation modulo 2^32, not a saturating cast.* Java's `d2i`
saturates and JavaScript's `ToInt32` wraps, so they disagree on exactly the
inputs that matter, silently. `hir::runtime` already declares `nts_to_int32`
with those semantics and is the single answer about conversions; the argument
path has to route through it rather than invent a second one.

So the boundary needs the same treatment in both directions — widen on the way
out, `ToInt32` on the way in — and only the outward half is in this patch.

### The third one-liner: unblocked, not written

`escape.rs`'s `Callee::External` arm taking a `keeps` answer **was** blocked on
this lane and is not any more. The `.bind` rows now carry what each member keeps
(`3db5aa33`), read from its own bytecode by `escapes::table` and keyed by the
same `owner.member:descriptor` the rows already use:

    56 rows in android-shape:  37 not analysed
                               12 proved nothing escapes
                                7 keep something

`-` and `.` are opposite claims and the format keeps them apart. `-` is "could
not read this method" — assume every argument escapes, always sound, only
pessimistic. `.` is "proved: nothing escapes", which is a claim. Writing the
second for the first turns ignorance into permission.

**What is left is one line and a signature, and it is not this lane's.**
`escape.rs:728` asks `runtime::keeps(name)`, which returns `&'static [usize]` —
and per-compilation rows are not `'static`, so the table has to reach
`gone_into_the_unknown`. That is two levels: `analyze_program` has the `Program`,
`analyze` does not, and **`analyze` already takes seven arguments**, which is
clippy's limit. Threading one more means restructuring a function in somebody
else's file for this lane's feature, so it is proposed rather than done.
