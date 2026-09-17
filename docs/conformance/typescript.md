# TypeScript language and runtime conformance

What compiles, what is refused, and what is missing entirely.

Companion to [`nodejs.md`](nodejs.md), which tracks the Node API surface, and to
[`test262.md`](test262.md), which tracks the numeric slice of the ECMAScript
suite. This file is the *language* and the *runtime under it*.

Two things it is deliberately not. It is not a conformance claim against
ECMA-262: this compiles a *typed* language ahead of time, and §13 sets out the
part of the specification that is a non-goal rather than a gap. And it is not a
plan — §15 is the plan for *coverage*, ordered by what real code is refused
for rather than by what looks incomplete, and §16 is the plan for *precision*:
the facts the checker proved that the IR does not carry.

## How this was derived

From probes, not from memory. Each row below was compiled by `nts hir` as one
exported function, and the lowering reports one diagnostic per function — so a
file of thirty functions answers thirty questions in one run.

Two mistakes are easy here and both were made while writing this:

- **A file that does not typecheck probes nothing** and every row reads as
  supported. Check for `does not typecheck` before believing a green column.
- **A declaration nested inside a function body is refused for being nested**,
  not for being what it is. `class C {}` inside a function says `this
  statement`; the same class at the top level lowers. Probe at the top level.

The independent measures are `tooling/gate/all.sh`: the corpus (184 files of
TypeScript's own tests), the examples (84 programs run against node case by
case), and the node profile (110 files, measured for *reach* — nothing runs it).

## Legend

| | |
|---|---|
| ✅ | lowers, and where it is observable the examples agree with node — *this row is the key, not a claim; the counts below exclude it* |
| ◐ | partial — the shape works, some of the surface does not |
| ✗ | a **gap**: refused today, wanted eventually |
| ∅ | **not a goal** — see §13, and the reason it is there |

`✗` and `∅` are both refusals at the compiler. The difference is whether
anybody should ever fix it, and conflating them turns a list of decisions into
a backlog.

### How much of the ✅ column carries its own evidence

`✅` has two clauses and a row can only show you one of them. "Lowers" is
checkable from the row by compiling the construct. "Where it is observable the
examples agree with node" is not — it needs an example, and the row has to say
which.

    instrument   awk over this file, counting rows that BEGIN `| ✅ |`
    taken        2026-09-15

      awk '/^\| ✅ \|/ { rows++
             if ($0 ~ /examples\//) cited++
             if ($0 ~ /no example/) gap++ }
           END { print rows, cited, gap }' docs/conformance/typescript.md

| | |
|---|---|
| `✅` rows | 159 |
| citing an example, a case count or a suite | 153 |
| naming, in the row, a part of itself nothing exercises | 9 |
| doing both | 4 |
| **saying neither** | **0** |

**Every `✅` row now says something.** 153 cite an example, a case count or a
suite; 9 name, in the row, the part of themselves nothing exercises; 4 do both;
none is silent. It was 139 silent of 159 on 2026-09-14.

**The count that matters is not the one that moved.** A row enumerating twelve
compound-assignment operators leaves the uncited column the moment one of them
finds an example, and `%=`, `^=` and `>>>=` stay exactly as unverified as
before. The nine gap-naming rows are the ones where that was checked and
written down — `var`, those three operators, `ReadonlyMap`/`ReadonlySet`, five
of six type-operator forms, `xs[next()] += 1`, a constructor type, the temporal
dead zone, a closure above its local's declaration, and `unknown` narrowed to
`{}` by a `!== null`. A fully-cited table would have hidden all of them.

**And the instrument was loose until the end.** Counting any line holding a ✅
gives 166 and includes this legend's own key, the header of the count table,
and `◐` rows whose prose mentions the character. The strict count — rows
beginning `| ✅ |` — is 159, which is what §15 and the 2026-09-14 block had been
reporting all along. Two numbers for one quantity, disagreeing by seven,
because one of them was written to be quick.

**How the thirteen were found, since the method decides what a citation is
worth.** Each uncited row's backticked tokens were searched across all 261
example sources by *fixed string* — no regex, after one pass with
`awk -v pat='\*\*'` reported that nothing exercises `**`. Then only tokens
appearing in **four or fewer** examples were kept: `const` and `import` appear
everywhere and a row citing an example because both contain the word `const`
would be decoration. Twelve rows survived that filter out of fifty-six, which
is the honest yield — the rest name constructs too common for a search to
distinguish, and they need somebody to decide which example is the *point* of
the row rather than merely a place the construct occurs.

A second pass matched row *subjects* against example directory names, which are
descriptive enough to carry it — `map-and-set`, `iteration`,
`a-throw-that-stays-in-its-function`. It found four more and, on the way, the
one result of this exercise that changes a claim rather than annotating it:
**`examples/map-and-set` never iterates a `Map` or a `Set`.** Twenty-one
`new Map`, five `new Set`, and not one `for...of` over either. It is the example
a reader would reach for to cite the two iteration rows, and it does not carry
them; `examples/iteration` does.

A search for that iteration had itself missed `examples/iteration`, because the
receiver is `m.keys()` — a string containing neither `Map` nor `Set`. Reading
the two candidates is what caught both the wrong citation and the missed one,
which is why the second pass had to be by hand rather than by another filter.

**Reading a window is the same mistake as reading a truncated table.** I read
the first fifty-five lines of `examples/accessors`, saw a subclass *adding* an
accessor, and was about to record that no example overrides one. The file
contains three: `Overriding` and `Middling` both override `Reading.plain`, and
`Doubling` overrides `Storing.value`. What caught it was searching every example
for the shape instead of eyeballing the likely one — the same correction the
`--top=` cap needed, in a file rather than in a report.

**And a search's scope is part of its answer.** A pass over
`examples/*/src/**/*.ts` reported that *no example re-exports* — no
`export { x as y } from`, no `export *`. Both exist: `examples/module-cycle-reexport`
and `examples/library` carry them, outside the `src/` directory the glob
assumed. Three of the four wrong answers in this exercise came from a search
that was narrower than the question, and none of them announced itself; each
returned a confident empty set.

**Three of the remaining rows are not rows.** The awk counts any table line
holding a ✅, and three of them are the legend's own key and the header of the
count table above — they can never be cited and should never have been in the
denominator. The honest remainder is twenty rather than twenty-three, and the
instrument says twenty-three because it was written to be cheap rather than
exact. Left as it is, with this note, because changing the awk now would make
every earlier number in this section incomparable with it.

**The method is written out because the last count and this one disagree by
86 and neither said how it counted.** The block here previously read 159 rows,
16 naming an example, 139 citing nothing, dated 2026-09-14. The case-count
number moved 13 → 14 over the same interval while the example number moved
16 → 102, which is the signature of a citation campaign rather than of two
different counting rules: the log carries it three rows at a time — *Three more;
97 of 159*, *100 of 159*, *149 of 217 examples now reachable from the ledger*.

That campaign was tracked in commit messages and not in the file, so the file
kept asserting a number the work had already moved. A count that lives outside
the thing it counts goes stale silently, which is the same failure this section
is about one level up.

**This measures citation, not correctness.** A row can be perfectly true and say
nothing about why; most of the uncited are ordinary language constructs that
many examples exercise incidentally. It is not a claim that 62 rows are wrong.

It is a claim about what a reader can check. For 62 rows the second clause of
`✅` is unverifiable from the ledger, and the sample so far says that is where
the wrong ones live: this file records rows whose explanation cell was empty and
whose claim was wrong, and `namespace` — eleven characters, no evidence — was
another. Every row corrected that way has come out of the uncited set.

**A citation is per row and a claim is per construct**, which the count above
cannot see. `| ✅ | compound assignment | += -= *= /= %= **= &= |= ^= <<= >>=
>>>= |` is one row and twelve claims. `examples/math` exercises `**=` and
`examples/bigint` exercises `<<=`, so citing either moves the row out of the
uncited column — while **`%=`, `^=` and `>>>=` are exercised by no example at
all** and stay exactly as unverified as before. The same is true of `block
scope, const/let/var`, where nothing uses `var`.

So a fully cited table would still hide this, and the number to watch is not
rows-with-a-citation. Where a row enumerates, the honest form is to say which
members carry evidence and which do not, in the row, which is what the four
rows corrected on 2026-09-15 now do.

A caution about the instrument, because it nearly produced the opposite answer:
searching the examples for `**` with `awk -v pat='\*\*'` matches nothing, since
awk reads that as a repetition operator with no operand rather than as two
literal asterisks. The first pass reported that **no example exercises `**`**,
which would have been a finding about the corpus and was a finding about the
search. `examples/math` had been exercising it the whole time.

## 1. Expressions and operators

| | | |
|---|---|---|
| ✅ | arithmetic | `+ - * / % **` — `examples/math` for `**` on numbers, including `Infinity` and a fractional exponent; `examples/bigint` for `**` on `bigint` |
| ✅ | bitwise | `& \| ^ ~ << >> >>>` `examples/bitwise` carries them, under the fact that makes them worth a row: `a \| 0` is how integer intent is written in JavaScript. |
| ✅ | integer `+ - *` **wrap** at 32 bits, as `(a + b) \| 0` is defined to | specialization narrows an accumulator to `int32_t` wherever the values are whole, which does not prove the sum fits. The C backend emitted a plain signed `+`, and signed overflow is undefined in C — so a long enough walk answered `3221225471` where node answers `-1073741825`, the same bits read as unsigned. Wrapped through the unsigned counterpart now. The LLVM backend was always right: its `add` carries no `nsw`. Held by a codegen text test, not by the differential, which cannot pin undefined behaviour — `examples/bitwise` carries the wrap constants themselves, `3221225471` and `-1073741825` |
| ✅ | comparison, equality | `< > <= >= === !==`, and `==`/`!=` where nothing coerces `examples/identity-across-subtype` carries the case that decides what equality means here, `===` between a subtype and its base, which is address equality. |
| ◐ | `==` that **coerces** | refused — see below |
| ✅ | logical | `&& \|\| !` — exercised throughout rather than by one example; `examples/erased-truthiness` is the case that is *about* it, `!x` on an `unknown` |
| ✅ | `in` with a **private name** — `#list in value` | the brand check, and the one key a compiler can see completely: it cannot be computed, cannot be forged, and is scoped by the language to the class body that declares it. It refused as "a key the compiler cannot see", which was exactly backwards. Restricted to the enclosing class and its subclasses, because two classes may each write `#list` and those are different names — a fixture without that decoy would have passed while every brand check in the tree accepted the wrong receiver. `this` as the receiver works too: inside a class body `this` is a *type parameter*, so one idiom had two spellings and only the spelling decided whether it lowered. Record 0283 `examples/a-private-name-is-a-brand` carries it, and carries the same `#list in value` this row spells — the brand check a class uses to recognise its own instances when a method has been detached. |
| ✅ | `in` with a literal key | the set of types declaring the property comes from the static type, so it is `instanceof` with a different question: a constant where every arm or no arm declares it, a class test where some do `examples/in-operator` carries the plain form, and `examples/in-on-a-native-receiver` the case where the representation already says what the receiver is. |
| ◐ | `in` naming an **optional** property is answered as of 2026-09-12; a **computed** key is not | the row said a presence bit would answer it and called that a layout change. **It cost no layout**: bits 0–5 of the object header's `flags` are spoken for by the string, array and collector flags and the other twenty-six were free, in a word every object already carries — one `or` on write, one `and` on test, and a required property still folds to a constant with no test at all. The two shapes answer differently and node is why the code knows: a **class field** is defined at construction even with no initialiser, so `"maybe" in new Box()` is true, while an **object literal** has only what it wrote. That is a difference in what construction does, not in what the question means, so both go through the same bit — the class's set by one constant-mask store at construction — and `delete` clears it either way. The shortcut of answering `true` from the type for a class was built first and is wrong for one program: `delete b.maybe`. A union tests one bit only where every arm declares the property optionally **and numbers it identically**, which is checked rather than assumed; base-first layout is why a subclass and its base agree. `examples/an-optional-property` is 377 cases across thirteen functions on C and LLVM. A computed key is unchanged and still leaves no set to test against. **Corpus yield measured rather than quoted: one distinct thing and two sites** — the census's 24-thing `in`-over-`object` item is the row below and did not move, because that is the whole-program candidate walk and this is the receiver's own type. The class mask is set where its field initialisers are — which, since 2026-09-12, is inside the class's own constructor rather than at the `new` site, so an instance the napi wrapper builds gets it too. That boundary was stated here as an open caveat for about an hour and closed with the placement it depended on |
| ✅ | `in` over **`object`** — `value !== null && typeof value === "object" && "k" in value`, which is how a program duck-types an `unknown` and is **67 sites in `runtime/node`**, the most of any refusal there. The candidate set is every object *type* the program has, by the same closed-world argument the union arms get; the `typeof` guard in front is what makes it sound, and an unguarded `unknown` is still refused because the type says so. Not every *class* — an object literal typed by an interface has a layout and no hierarchy entry, and asking the hierarchy answered `false` for `"label" in { label: "l" }`. Record 0164 — `examples/in-on-a-record`, and `examples/in-on-an-object-a-native-answers-for` for the case where the receiver is a native value |
| ✅ | `in` over `object` naming a key a **natively represented** type answers for — `then`, `length`, `buffer`, `byteLength` | **this row was ✗ while the feature was landed, and an example for it was already in the tree.** `examples/in-on-an-object-a-native-answers-for` runs 290 cases across ten functions and agrees; its own header describes this row's subject in the past tense. Re-probed 2026-09-13 against a separate fixture as well — `"then" in v` over a `Promise` and a plain object, `"length" in v` over an array, `"buffer"`/`"byteLength"` over a `Uint8Array` and an `ArrayBuffer`, 145 cases across five functions, each arm answering differently for the two branches so a constant `false` would show. It agreed on the binary from the **start of that session** too, so it was landed before the day began. The machinery is `natives_declaring`, a name-to-native table: `then`/`catch`/`finally` → `Promise`, `length` → array, typed array and function, `buffer`/`byteOffset` → view, `byteLength` → view and `ArrayBuffer`. **`size` is the one still open and it is not this row's fault**: it maps to `Map` and `Set`, which are deferred, so the entry is there and unreachable. A ✗ is not proof of absence any more than a ✅ is proof of coverage — which is this table's own standing caveat, pointed the other way |
| ✅ | `in` over `object` naming a key **some type declares optionally** — answered as of 2026-09-12 | the refusal said this was "sound and the honest cost of the whole-program answer": with the value typed `object` an instance of any type can reach the test, so one declaring the key optionally makes it unanswerable in both directions — including it answers true for a property never written, excluding it answers false for one that was. **Both halves are still true and the conclusion stopped following** when the object header started recording whether an optional property was written. Such a type now contributes `is it a C` **and** `is C's bit set`, which is the class test that was already being emitted for the always-declaring types with a second conjunct. A plain `and` rather than a short circuit, because `nts_presence_has_value` answers false for a non-reference, so the arm that failed the class test cannot fault in the second. The census ranked this at **24 distinct things over 41 sites in 17 modules** — the largest item in the queue this lane had machinery for, and the one the receiver's-own-type row did *not* move, because it is a different lowering path. `examples/in-over-an-object-with-an-optional-declarer` is the fixture, including a property written as `undefined` — identical to a written one when read back, and the whole distinction. **What it cleared, measured either side: the refusal is gone from the census entirely, and the count went up.** 849 distinct things become 873, because 24 functions that stopped here now walk further and reach their real reasons — `a union whose members lay their fields out differently` rises 38 to 57 and takes the top of the table. That is the chokepoint moving rather than the axis, which this file's own reading note warns about: a refusal count and a *lowered* count are different currencies and do not convert. **And the 57 was itself a misreading, found 2026-09-12**: the message it counts asserted a disagreement between union arms without testing one, so most of what moved here was intersections wearing a union's sentence. See §16's row and record 0309 |
| ✅ | unary | `+x -x`, `++ --` prefix and postfix `examples/a-unary-plus-is-a-conversion` carries the half that is not arithmetic: `+x` is `ToNumber(x)`, the same operation `Number(x)` is. |
| ✅ | compound assignment | `+= -= *= /= %= **= &= \|= ^= <<= >>= >>>=` — `examples/math` for `**=`, `examples/bigint` for `<<=`. **`%=`, `^=` and `>>>=` are exercised by no example**: the row enumerates twelve operators and three of them rest on the first clause of ✅ alone |
| ✅ | conditional | `c ? a : b`, nested `examples/conditionals` carries it — a ternary is an `if` that produces a value, so it lowers to the same shape. |
| ✅ | `typeof` | folded from the representation, a branch across one absence, a tag read on an erased value — it refuses nothing `examples/typeof` carries the case this row is about — `typeof x` where `x` has a single known primitive type, as distinct from the tagged case in the representation section. |
| ✅ | template literals | including interpolation `examples/templates` carries them, under the observation that a template literal is a concatenation written with fewer plus signs. |

### `==` between types that differ

`==` and `===` agree exactly where both sides have the same representation, and
under `strict` the checker rejects most comparisons where they do not. It does
not reject `unknown == unknown`, and there JavaScript's abstract equality
converts before comparing:

```js
1 == true      // true
[1] == 1       // true — the array is converted to a primitive first
"a" == 1       // false
```

All three were answered by `nts_value_strict_eq`, so all three came back false.
Doing it properly needs `ToPrimitive`, which means `valueOf` and `toString` on
this compiler's object model, so it is **refused by name** rather than answered
wrongly.

`x == null` is not this and still works: it is the *absence* question, answered
by the tag pair for an erased value and by the null pointer for a reference. It
is also the only loose comparison real code writes — 273 in the node profile,
against **zero** uses of the refused form.

Where the type admits **no** absence at all, both operators are a constant and
neither converts anything. Abstract equality returns false as soon as one side
is absent and the other is not, before any `ToPrimitive` — so `n == null` on a
`number` is false, `n != null` is true, and no coercion was ever involved. This
was refused for a year under the coercion message, because lowering the `null`
came first and a double has nowhere to put one. Thirty-two profile sites, and
`x == null` is how TypeScript spells the nullish check.

The *comparison* is the constant, not the expression. Folding the operand away
with it made `next() === undefined` skip a call node makes — found by asking a
counter, not by reading the emitted C.
| ✅ | object and array literals | shorthand, computed keys, quoted keys `examples/shorthand-property` carries the shorthand, on the observation that `{ x }` is `{ x: x }` and for a long time only one of them lowered; `examples/an-array-literal-at-the-slots-element` carries the array half. |
| ✅ | member access | `o.x`, `o["x"]`, `o[0]` `examples/a-computed-index-is-not-a-member-name` separates `o[i]` from a member name, and `examples/a-dotted-read-on-an-index-signature` carries `t.a` where `t` is a `Record<string, T>`. |
| ✅ | `new` | user classes, `Array`, typed arrays — `examples/array-buffer` and `examples/data-view` construct both. The **methods** on a typed array are a separate question and 17 of them refuse; see §8 |
| ✅ | `??` | the absence test, not the truthiness one — `0 ?? 1` is `0` `examples/nullish` carries it, named for the distinction this row draws: `??` asks a different question from `||`. |
| ✅ | `??=`, `\|\|=`, `&&=` | a test and a store that happens on one path only, not `a = a \|\| b`. The right operand is evaluated inside the arm, so `a \|\|= f()` does not call `f` when `a` is truthy; the target is lowered once, so `xs[next()] ??= 1` calls `next` once. `??=` asks the absence question and `\|\|=` the truthiness one — `n \|\|= 1` overwrites a `0` and `n ??= 1` does not `examples/logical-assignment` carries all three, as a test and a write that happens only sometimes. |
| ◐ | `??=`, `\|\|=`, `&&=` **through an accessor**, and `+=` with them | a write target is a `Place`, and for an accessor that was the receiver and the setter. A plain `o.x = v` needs nothing else, which is why the gap was narrower than `an assignment that reads through an accessor` suggested; a compound assignment reads first, and that read is a call to the **getter**, which the place did not carry. It travels with the setter now, resolved where the place is built — two places asking the hierarchy the same question is how they come to disagree. The setter's declared type travels too, for the store to coerce toward: without it `??=` handed the setter an `f64` where it wanted an erased slot and the verifier said so rather than the program being wrong at run time. **Still refused where the accessor's value is erased** — the read is both the absence test and the result there, wanting the tag for one and a number for the other, and a getter call is not a slot for the flow analysis to narrow the way it narrows a field. `examples/assignment-through-an-accessor`, five exports **reporting how many times each accessor ran**, because `||=` on a truthy left must not call the setter and a fixture reading only the value cannot tell. C, LLVM and JVM |
| ✅ | `?.`, `?.()`, `?.[]` | member, call and index, through either absence or both. Two *optional* links chain — each tests its own receiver — and a **non**-optional link after an optional one is refused and named **Probed 2026-09-13 and the ✅ is wrong for one of the three.** `a?.b()` -- an optional chain whose next step is a **method call** -- refuses by name: ``an optional-chained method call (`a?.b()`)``. `lower_method_call` destructures its callee as `[receiver, member]`, and an optional-chained member access has **three** children because the `?.` is a token of its own between them, so the shape falls through to a refusal. What is green is the neighbouring spelling: `a.b?.()`, a function-valued property called optionally, which is row 162 and lowers. The two look alike and are different nodes. **Measured**: 76 distinct source sites across 24 files in `runtime/node`, and 241 *refusal instances* across five modules -- the larger number counts a site once per specialisation of the function holding it, so the two are different units and neither is the other. Uniform in shape: **zero** of the 76 carry a second `?.`, so none is the `a link after an optional access` case that is separately refused. Tractable and unbuilt: the machinery exists beside it -- `lower_optional_access` and the `Branch::Invoke` arm already do `absence_of` then `present_of` then `lower_branching_value` -- and what it wants is the same three steps with a method call in the present arm, which needs `lower_method_call`'s 183 lines split so the arm can be handed an already-lowered receiver. **Built 2026-09-13, and the row is green again on evidence rather than on assumption.** `lower_method_call` is split: `lower_method_on` takes a receiver that is already lowered, and `lower_optional_method_call` does the three steps `lower_optional_access` does -- `absence_of`, `present_of`, `lower_branching_value` -- with a new `Branch::MethodOn` in the present arm. The arguments are lowered **inside** that arm, so `a?.b(f())` does not call `f` when the receiver is absent, and `examples/an-optional-chained-method-call` has a counter arm proving it. Both arms of the control: the pre-change compiler at `5031bc2c` refuses the example at three sites, and with the change it agrees with node on 116 cases across 4 functions. Corpus, both binaries on one tree: the refusal goes **42 -> 0** in `net`, **56 -> 0** in `http`, **50 -> 0** in `stream`, **58 -> 0** in `fs` and **35 -> 0** in `events`. Root refusals fall only 36 across those five, because clearing one refusal in a function exposes the next one behind it -- a feature can be entirely landed and barely move the headline, which is why the specific message was counted rather than the total. |
| ✅ | assigning to an array's **`length`** — `list.length = write` | truncation, which JavaScript does in place and this compiler refuses as ``assigning to this property``. **Measured 2026-09-13**: 62 source sites across `runtime/`, and 114 refusal instances each in `net`, `http` and `fs` plus 111 in `stream` — the same figure in each because the sites live in shared files (`url/src/searchparams.ts`, `web-platform/src/cache/*`) that every module's closure pulls in. Every one is a compaction: a loop writes survivors to a `write` cursor and then cuts the tail. **Two routes, and the cheap one is wrong for this project.** `nts_array_splice(a, n, len - n)` exists and would do it today, but it hands back the removed run *as a new array* — an allocation JavaScript does not make, once per compaction, in code whose whole purpose is to avoid one. The right version is an in-place `nts_array_set_length`, which is a **new runtime helper** and therefore three tables: `hir::runtime`, the LLVM signatures and the JVM's. `bench-agree` has no allowance list, so a helper present in two of three red-gates the third — it is a coordinated change by construction and is filed rather than started for that reason. **Contract settled with the JVM lane 2026-09-13, and their row is landed and inert (`8d631769`) so the remaining tables can follow without reddening anyone.** `void nts_array_set_length(NtsArray *a, double n)`: `n < len` truncates, `n == len` does nothing, `n > len` **refuses** -- growing produces holes, which have no representation here at all, so refusing is the only available answer rather than merely the safer one. Non-integral and negative refuse too, both being `RangeError` in JavaScript. All 62 corpus sites shrink, so the refusing half costs nothing today and exists so the feature is not silently half-answered. **The two lanes do different work for the same reason, and the header should say so**: C must *release* the dropped run, because an array holds a count per element and `splice` only avoids it by **moving** the references into the array it returns; the JVM has no retains and must *clear* the slots, because a stale reference in the backing array keeps its object alive as long as the array does. The shared fact is "the dropped elements stop being reachable", not "call release" -- stated the wrong way, the JVM row reads as if it skips a step. Their assertion for it is the one every other line would have passed without: remove the fill, keep the length store, and it fails on *the dropped slot is cleared, or the collector cannot free it*. Still to build: the C, the LLVM signature, the `changes_array_length` entry -- which `747ab290` now forces, since an unclassified helper fails the classification test by name -- and the lowering. **Landed 2026-09-13 (`0b3ded3f`), and the yield was twenty times the site count.** The corpus profile moves **18,206 refusals to 16,742** and 20,237 definitions to **21,771** -- 1,464 fewer refusals and 1,534 more definitions, from one property assignment at 62 sites, because each one was the *head* of a chain. That is the exact inverse of `a?.b()` earlier the same day, where all 241 instances cleared and the root count moved 36: there every refusal had another behind it. Neither number predicts the other, and only measuring both says which case you are in. `Place::ArrayLength` rather than a field store, since the dropped run has to stop being reachable; `write_place` picks `_ref`/`_value`/plain by element type, which is the feature and not a detail. Control: `5031bc2c` refuses `examples/an-array-length-assignment` at three sites, and with the change it agrees with node on 87 cases across 3 functions through **both** the C and the JVM backends. Still refused by name: `xs.length -= 1`, which reads a place before writing it, and growth. |
| ✅ | `Promise.withResolvers()` — the capability object | **landed 2026-09-16, as the representation [[0337]] reverted.** `PromiseWithResolvers<T>` holds nothing besides the promise — `resolve` and `reject` are the two settles the runtime already performs with the promise as the receiver, and `promise` is the promise — so it is *represented as* `Promise<T>`: no layout, no allocation, no closure. `examples/promise-with-resolvers` is 203 cases across seven exports and agrees with node, and the arm that earns it is `ordering`, where `consume` suspends at its `await` and node answers `1,2,4,3` rather than `1,3,2,4` — a resumption folded into the call to `resolve` would show. **That example proves nothing on its own and is not what landed this**: it was written by the author of the change from the change's own model, which is precisely [[0337]]'s lesson. The corpus is: `addons.sh` gives **24 of 24 still build, 0 regressed**, controlled against the pinned binary giving the same. **22 distinct sites cleared** across `stream`, `fs`, `zlib`, `util`, `http` and `web-platform`; the NTS1001 totals moved by 1 to 13 per module, because a cleared blocker publishes the next one. **Five distinct sites still refuse** and say so by name — ``a promise capability's `resolve` used as a value rather than called`` — which is `broadcast.ts`'s `state.resolve = pending.resolve` and its four siblings. Those need a closure with no source node, which is [[0336]]'s decomposed form and is now in nobody's way. What [[0337]] measured as the representation failing was a **latent defect in the reject path** it made reachable, recorded as [[0339]] |
| ✗ | a nested object literal assigned where an **optional** property is declared | it gets its own anonymous type, laid out with a pointer where the declared one has a tagged value. **Re-probed 2026-09-13: it refuses, and nothing segfaults.** The row said reading it back segfaults, which is a wrong answer that runs and would rank this far higher than it deserves; what is live is three refusals by name. The shape matters, because a reduced probe passes: `{ tag: 1, inner: { a, b } }` read straight back, and the same with `inner` absent, **compile and agree with node over 58 cases**. Three harder arms do not — a union of two literals where only one has the property, and `"inner" in o`, both give `an erased value where a concrete representation is wanted`; and passing the object to a function that reads it gives `a `Outer` where `an anonymous type` is wanted, which is a pointer cast between two structs that do not agree about where their shared fields are`. **That second message is the refusal census's number one row** — 48 things, 66 sites, 20 modules, filed as `annotated-const-read` — so this row is a route into that cause rather than a defect of its own, and the two should not be built separately. The first is the census's `an erased value where a concrete representation is wanted`, 20 things across 19 modules. Pre-existing; see the anonymous-type row in §4 |
| ◐ | spread | every shape of it in an **array literal** works — `[...a]` is a copy, and `[...a, x, ...b]` sums the lengths before allocating. Into a **call**, `f(...args)` works where the arity is known at compile time — a tuple, or a fixed-arity rest being forwarded — and is expanded into that many arguments, one indexed read each, because the callee has a fixed parameter list and the count is what fills it. A spread of a `number[]` has no count and still refuses; `{...o}` does not work. Record 0287 `examples/a-spread-into-a-rest-parameter` carries the call-argument form, `f(a, ...rest)`, and `examples/spread-in-an-object-literal` the object form. |
| ◐ | `Object.hasOwn` over a type with an **optional** property is answered as of 2026-09-12; `Object.keys` is not | they report what an object *has*, and the slot exists whether or not it was written. Answered from the layout until now, which gave `["keep", "maybe"]` for `{ keep: 1 }` where node gives `["keep"]`. **`hasOwn` names one key, so it reads that key's presence bit** — the same question `"k" in o` asks in the other spelling, reading the same bit; `examples/has-own-over-an-optional-property` is 145 cases across six functions on all three backends. A **required** key on the same type stays a constant with no test, and that half is the one that regressed while this was written: the path went through `own_names`, which rejects a type carrying *any* optional property because `Object.keys` has to name all of them, so a required key refused on account of a different property entirely. The constant comes from the layout's `fields` rather than the checker's member list, because a method is declared and is not an own property. **`Object.keys` still refuses**: it names no key, so it needs every optional property of the receiver resolved at run time — a loop over the layout producing an array whose length is not known until it runs, and a presence-bit set keyed by *name* cannot supply it. **Ranked rather than assumed, and the answer was zero**: `an \`Object\` static over a type with the optional property` is emitted by **0 of the 10 modules that call one** — `assert`, `http`, `zlib`, `util`, `child_process`, `console`, `stream`, `querystring`, `url`, `process`, every module in `runtime/node` containing an `Object.keys`, `Object.values` or `Object.entries`. 32 `Object.keys` sites in 11 modules and not one of them is over a type with an optional property, so building this clears nothing today. The one caveat is the honest one: a site inside a function refused for some *other* reason never reaches this refusal, so the number counts what the compiler got to, and it would be a floor rather than a total if the blockers above it cleared. `Object.values` is **0 sites** corpus-wide, and `Object.entries` is 7 across 2 modules |
| ✅ | `delete` | TypeScript permits it only on an optional property (TS2790), which already holds `T | undefined` with a tag — so a deletion is a store of that tag **and a clear of the property's presence bit**. It used to be the store alone, and the row's soundness argument was that nothing could see the difference from `= undefined`: `in`, `Object.keys`, `Object.hasOwn` and `for...in` all refused on an optional property. `in` stopped refusing on 2026-09-12, and the argument stopped holding the same day — the bit is what replaced it, so the row is now sound because the difference is *recorded* rather than because nothing asks. `delete_expression.rs` caught the first version recording a **write**, which is a deletion saying the property is there `examples/delete` carries it, as `delete o.x`. |
| ✅ | `void`, comma | neither is arithmetic, which is why neither had a place in the table that refused them. `void e` lowers its operand **for its effects** and answers `undefined` — the operand's type does not reach the result, so `void 0` is `undefined` and not a number, and `void f()` still calls `f`. Not folded away where it can have no effect: that is dead-code elimination's job and it already does it. `a, b` **sequences** rather than combines, so it is handled before `lower_binary`'s operator table rather than given a `BinOp` it could never have had — there is no result of `a` for an operator to apply to, which is exactly what `the operator a comma token` was a true and useless sentence about. `examples/void-and-comma`, five exports each counting a side effect as well as reading the value, because both operators are about evaluation order and a fixture reading only the value could not tell a folded operand from an evaluated one. C, LLVM and JVM |
| ✅ | `instanceof` | against a class this program declares — **including one reached through an `import`** — or one of the seven provided error classes. The set of classes that satisfy it is closed when the program is built, so it is a comparison and not a walk. The import case was refused for as long as this row has existed: a reference to an imported name resolves to a symbol declared at the *import site* and a class's type is filed under the declaration's, so the lookup found nothing and said the compiler had no class for it. **18 sites in `runtime/node`**, `chunk instanceof Buffer` among them. Record 0157 — `examples/open-typed-values`, twenty uses, and `examples/two-classes-one-descriptor` for two classes sharing a descriptor |
| ✅ | `instanceof` between a class and an **empty subclass of it** | `class Circle extends Shape {}` has `Shape`'s fields and dispatch table, so layouts merged them and `s instanceof Circle` was true of a `Shape`. `Layout.base` tells them apart, compared *inside* `same_shape` so neither of its two callers can forget it — `examples/typed-array-subclass` covers the same shape where the base is a typed array |
| ✅ | `instanceof` between **any two declared classes**, however alike | two empty siblings of one parent, two unrelated classes with identical fields, two classes extending `TypeError` with the same `code` — all four shapes answered `true` where node answers `false`, with nothing refused. The merge is required and stayed: TypeScript is structurally typed, so `readA(new B())` must pass and `readonly.rs` asserts the sharing on purpose. What moved is that **identity now lives beside the layout rather than in it** — `Program::classes`, keyed by the declaring symbol — and each class gets its own descriptor over the shared struct. `canonicalize_objects` was the eraser, not the merge: it rewrote every object type to its *layout's* representative, so `lower_new` pushed `Object(B)` and the backend received `Object(A)`. One representative per class. Record 0286, `examples/two-classes-one-descriptor`, all three backends |
| ◐ | `instanceof` against a **natively-represented** type | **remeasured 2026-09-12, and most of it works.** Three shapes through one `unknown` parameter — `Uint8Array`, `ArrayBuffer` and a plain array — are told apart correctly at run time, because a descriptor carries an `element` kind and a `size` and that is precisely the question. `Promise`, `Int16Array`, `Int32Array` and `Float32Array` likewise. What remains is **five** causes — six until `AggregateError` landed on 2026-09-13 — rather than the three this row named, and every one is principled: **`Uint8ClampedArray`** stores by clamping where the others wrap, and `typed_array_element` leaves it out rather than give it the wrapping conversion; **`BigInt64Array`** because this `bigint` is 128 bits; **`SharedArrayBuffer`** has no class, and it is what refuses the two `value instanceof ArrayBuffer || value instanceof SharedArrayBuffer` sites that read as `ArrayBuffer` failures; **`AggregateError`** was here for carrying an `errors` array, which did not fit a list whose premise is that its members hold the same two fields — **fixed 2026-09-13 by moving the premise**, so this is now one cause fewer and the row's "six" is five; **`RegExp`** and **`Map`/`Set`** are deferred, the latter refusing at `new Map()` rather than at the test. 22 refusals across `buffer`, `util` and `stream` |
| ✅ | `f.call(receiver, ...rest)` | the receiver is **dropped**, and that is a substitution rather than a narrowing: the set of function values that could observe one is empty. A `function` reading its own `this` is refused, a declaration doing so is refused, and a *method* — whose `this` is a real parameter — cannot be taken as a value at all. Three refusals argued separately, together making a fourth thing correct; `blockers/a-call-with-a-receiver-that-is-read` holds them, because the day any is implemented this becomes silently wrong. 17 sites across 7 modules, `EventEmitter#emit` among them. A receiver parameter in the closure calling convention was measured first and rejected at ~0.13 ns per indirect call. Record 0284 `examples/a-call-with-an-explicit-receiver` carries it. |
| ✅ | `f.apply(receiver, args)` | not the same lowering as `call` — it takes its arguments as an array where `call` takes them positionally — but it reaches the same call. Where the callee has a **rest** parameter the list is that parameter, copied rather than passed through, because a rest is fresh on every call in JavaScript. Where the callee is **positional** the arity has to come from somewhere, and both sources are needed: a literal carries it syntactically (`fn.apply(undefined, [x])` widens to `number[]`, so the type answers nothing), a value carries it only when its type is a tuple. What comes out is `call.closure[0] %0(%0, %1)` — the array is notation, not data. An array whose length exists only at run time is refused by name, which is also what TypeScript does. Records 0284 and 0288 `examples/an-apply-whose-list-has-an-arity` carries it, onto a callee that takes its arguments positionally. |
| ◐ | tagged templates | `` tag`a${x}b` `` is a **call**, and the specification says what its arguments are: an array of the literal pieces, then one argument per substitution in source order. So the lowering builds the array, evaluates the substitutions left to right — observable, since one may call something — and hands both to the tag. **Two things were missing and only one was the expression.** `TemplateStringsArray` had no representation at all: lib.d.ts declares it as a `ReadonlyArray<string>` with a `raw` beside it, and `readonly string[]` already represented, so the interface was decomposed at the library boundary and came back with nothing — a tag's *parameter* refused before the expression was reached. It represents as `string[]` now, which is what a tag receives and indexes. **`raw` is deliberately absent**: it is the un-cooked text, a second string list this compiler does not build, so reading it refuses as an ordinary member of an array rather than answering the cooked strings to a program that asked for the raw ones. Two shapes still refuse, each by its own name: a tag that is **not a plain declared function** — `lower_call` resolves a callee through qualified names, generic suffixes, static and method dispatch, closures and imports, and duplicating any of it here would be a second derivation of *which function is this* — and a tag taking a **rest parameter**, which wants the substitutions as one array and is the spread machinery. **The array's identity is not interned and that is observable**: the specification interns the template object per call *site*, so `strings === strings` across two calls of one tag is `true`, and this rebuilds it per evaluation. A memoising tag would miss every time. Written down because no arm can see it, and the fix is an interned per-site constant rather than anything about this lowering. `examples/a-tagged-template`, **145 cases across five exports** on C, LLVM and the JVM, including an arm that counts calls to prove the substitutions run left to right exactly once — the only arm that could see it. **Zero corpus demand, measured**: 0 refusals across eight modules, and the 2515 the first source census reported were backticks in comment prose |

## 2. Statements and control flow

| | | |
|---|---|---|
| ✅ | `if`/`else`, `switch` including fall-through | `examples/control`, whose `switch` carries the fall-through Are We Fast Yet's own test exercises |
| ✅ | `for`, `while`, `do`/`while`, `for...of` over an array `examples/iteration` carries `for...of` over the three things this compiler can walk; `examples/loops-that-always-leave` the body that never reaches its own end. |
| ✅ | `break`, `continue`, `return`, `throw` `examples/exceptions` carries the `throw` half together with the `catch` that receives it. |
| ✅ | block scope, `const`/`let`/`var` — **no example uses `var`**, so that third of the row is uncited and untested |
| ✅ | destructuring: object, array, nested, rest element `examples/destructuring` carries them, under the claim that a pattern is the reads it stands for. **And an elision, as of 2026-09-17.** `const [, second] = pair` was refused, and so was `for (const [, v] of map)` — the way a `Map`'s values are iterated. The frontend gives a hole as a **binding element with no children**: no name, no property, nothing to write to. Both sites that walk a pattern refused it under different messages — ``a binding of unexpected shape`` from the declaration path and ``a destructuring element that is more than a name`` from the `for...of` head — for one cause. A hole binds nothing and still **occupies a position**, and the two facts have to travel together: the count is what says `v` is the second element. The declaration path already enumerated, so skipping was enough; the `for...of` head carried a `Vec<NodeId>` that could not express "no name here" and carries `Vec<Option<NodeId>>` now. `examples/a-hole-in-a-destructuring-pattern` is 203 cases across seven exports on all three backends, six refusals on the pre-change binary; `twoHoles` and `positions` are the arms a skip that forgot to count would fail, and `noHoles` is the control. A **trailing** hole is dropped by TypeScript, so `[k, ]` is `[k]` and over a `Map` that is the pre-existing one-name ambiguity rather than this |
| ◐ | `try`/`catch`/`finally`, a bare `catch { }`, and a `throw` of any type | **within one function, and a call inside a `try` is refused as of 2026-09-12.** A `throw` lowers to a jump to the enclosing handler *block*, which is a branch inside one function; a callee has no edge back to its caller's handler, so a throw raised inside a call abandoned the program where node's `catch` runs. Measured on all three backends: `try { return deep(n) } catch { return -1 }` gave `10 case(s) the compiled program declined` against node's -1, and the JVM emitted no exception table at all. **The row was ✅ and was true of the half it had been tested on** — same-function `throw`/`catch`/`finally` agrees on 58 cases and still does. Refused rather than left wrong, and the node lane priced that against its own axis rather than my guessing: 25 of its 49 compiled-lane files are in modules with no such `try` at all, and **the defect is masked by the boundary** — a module must publish a function before a caught throw inside it is reachable, and `assert` fails 13 of 13 on names that do not exist. So the refusal is cheapest now and grows dearer as publishing improves. Only calls that can **reach a `throw`**, which is a whole-program fixpoint over the call graph, not a test for "is it compiled": the coarse version refused `new ArrayBuffer(bounded(n))` and cost `examples/array-buffer` six tests. Excluded for stated reasons rather than by tuning — a provided error's constructor is emitted inline and a runtime helper aborts rather than throwing, so `try { throw new RangeError(m) } catch { }` keeps working; an `async` callee never raises *synchronously*, so `try { await failing(n) } catch { }` keeps working and `examples/async-catch`'s eight functions still agree; and an unresolved callee — `fns[0]()` — joins the set, because what it reaches is the one thing this refusal exists because the compiler cannot establish. `examples/a-throw-that-stays-in-its-function` holds all four arms and `compiler/core/tests/throw_across_a_call.rs` asserts each by name. Closing it properly is cross-call exceptions: an exception table and a handler block on the JVM, and on C **not** the `NtsLanding` `setjmp` pair that already carries a throw across the napi boundary — its own docstring says why, since a `longjmp` skips the releases the reference-counting provider inserted between the throw and the frame it lands in, so every frame thrown through leaks what it held. Unwinding the counts is the feature, not the jump |
| ✅ | labelled `break`/`continue`, on a loop or a `switch`. A label on a *block* is refused: its `break` is a forward jump, which wants an exit with no latch — `examples/loops`, `outer: for` |
| ✅ | `for...of` over a string — by code point, so a surrogate pair is one element — `examples/string-methods` and `examples/iteration`, both over the surrogate pair |
| ✅ | a default inside a destructuring pattern, including renamed and nested. `{ a: b }` and `{ a = b }` encode identically, and are told apart by which name the binding element *declares* — `examples/destructuring`, which carries `{ name = "xy" }` and the renamed-with-default `{ name: label = "z", flag }` |
| ◐ | `for...in` | **over an object**, which is the same loop `for...of` uses over a different sequence: the keys rather than the elements. One `lower_for_of` taking which it wants, because everything after the sequence — the cursor, the latch, `break`, `continue`, the loop-carried names — is identical, and a second loop would drift from the first. The keys are the layout's field names in the order the program wrote them, which is the list `Object.keys` already answers. **Both of JavaScript's differences from `Object.keys` vanish here**: a compiled class keeps its methods on the descriptor rather than as own properties, so there is no prototype chain to walk and nothing enumerable to inherit. Over an **array** it is refused — node answers the indices *as strings*, which is neither the field names nor anything this builds, so it declines rather than answering the wrong list. Still zero uses in the node profile. `examples/a-for-in-over-an-object`, C, LLVM and JVM |

## 3. Functions

| | | |
|---|---|---|
| ✅ | declarations, arrow functions (both body forms), IIFE `examples/a-local-const-in-every-kind-of-function` carries all three, by declaring a `const` inside each and checking the kind of function does not change what a local is. |
| ✅ | a function declared **inside a body**, including one called above its own declaration and two that call each other — the walk visits every declaration in the file, so hoisting falls out rather than being arranged. One that reads a local of the function around it is a closure, and is refused by name `examples/a-nested-function-that-captures` carries it, including the recursive case where the name is bound to the receiver inside its own body. |
| ✗ | a nested function whose name is already taken at the top level — the namespace is flat, so both are refused. The name is not qualified by the function it is written in | **The larger thing wearing a neighbouring message landed on 2026-09-13.** A nested function reading a local of the function that declares it — `a name from an enclosing scope`, 20 things across 17 modules — is a **desugaring**: a nested `function` declaration is a hoisted `const` holding a function expression, and the same body written either of the other two ways lowered all along. Five places: the collector takes it, the declaration loop stops emitting a top-level function for it, the statement allocates and binds, the call site routes through the binding, and inside its own body the name is bound to the **receiver** so it can recurse — which the row's motivating site needs, being "a recursive matcher". Four of the five were right first time and the call site still resolved directly, because a `FUNCTION_DECLARATION` node **carries no symbol**: its name child does, and binding under the declaration's own bound under `None` and returned before the allocation ran. Restricted to declarations that actually **capture** — taking every nested one left 210 `a declaration outside every walk` in `util` alone. Corpus: util 5→1, net 21→1, assert 4→0, stream 21→0, http 24→1, with module totals falling 4 to 30 as the cascades clear and nothing going up. `examples/a-nested-function-that-captures`, 145 cases across five functions, all three backends. What remains is one that **binds its own `this`** — a closure inherits the enclosing receiver, which is the line the `function` *expression* arm has always drawn — and use *before* the declaration, which hoisting would not fix because this captures by value: an allocation moved to the top of the block reads locals that have no values yet. `blockers/enclosing-scope-name-in-a-nested-function` holds both. **Probed 2026-09-14, and the row stands.** A nested function with a unique name compiles clean; renaming it to collide with a top-level `helper` — one variable, same program otherwise — refuses with `NTS1001 a second function named \`helper\` in the same file`. So what remains is the *name*, as written, and not the capture work that landed beside it. The refusal is `ambiguous_name` at `hir/lower.rs:2454`, reached from the declaration-emission loop, which means both declarations are still being emitted as top-level C functions competing for one identifier. `unshared_name` already exists for exactly this shape and is what module-scope statics use (`lower.rs:2432`), so the machinery is present; what it would cost is that an emitted name is also what headers, addons, JVM descriptors and the LLVM table spell, so renaming one is a change with four readers and wants the full gate rather than a lowering test.
| ✅ | optional parameters, default parameters | including a default that **reads the parameters before it**. JavaScript evaluates a default in the callee's scope and this compiler evaluates it at the call, which is the same moment and a different scope — so the caller binds the callee's names to the arguments it has already computed, for the length of one expression, and puts them back after. A default reading a *later* parameter is TS2372 and never arrives. Record 0116 `examples/defaults` carries the fill-in at the calls that omit it, and `examples/parameter-defaults` the default that reads the parameters before it. |
| ✅ | **overload signatures**, on a method and on a plain function. TypeScript matches a call against whichever signature fits and those are separate declarations with no bodies, so everything a call is built from — its arity, each argument's representation, where a rest begins, and whether the callee is defined at all — comes from the **implementation** beside them. This row read ✅ while methods were refused by name at **56 sites** and a plain overloaded function link-errored with `undefined reference`, which is the first false row this ledger has been caught holding. Record 0153 `examples/overloads` carries them, together with the implementation every call actually reaches. |
| ✅ | generics, including constrained; monomorphized per instantiation `examples/generics` carries it — lowered once per instantiation and not at all as a generic. |
| ✅ | higher-order functions and closures that only *read* what they capture `examples/closures` carries them, under the representation this row depends on: a closure is an object with one method. **Including one closure capturing another, as of 2026-09-17.** That refused until then, and not at lowering: a capture is typed twice — the enclosing function stores the value and takes the value's own type, the body reads the field back and took the *checker's* type of the name. Those agree for a captured number and not for a captured arrow, whose checker type is its function type and has no layout, so the store said `managed<closure#0>` and the read said `managed<obj#4>` and the C backend answered ``an object type with no layout: type 4``. The two sides' `Field` lists are merged by `collect_layouts`, whose comment calls that merge *"the check that the two sides agree"* — it merged them without noticing, because the field's name and index agreed and only its type did not. The read now asks what the store answers, through `closure_bound_to`: a name bound to a **`const`** arrow has that closure's layout, which is `closure_typed_global`'s soundness argument word for word. `examples/a-closure-capturing-a-closure` is 174 cases across six exports agreeing with node, where the pre-change binary refuses fourteen times; its arms go three deep, capture a closure beside a number, and share one captured closure between two capturing ones. A **reassignable** variable is refused by name — two arrows are two layouts — where it used to reach the backend and be told about `type 4`; `blockers/a-closure-captured-through-a-reassignable-variable` holds it |
| ✅ | a **named function used as a value** — one static instance, so identity holds `examples/module-functions` carries the module-scope `const` holding one, and `examples/many-closures` the case that pressures the identity claim: sixteen closures and a class used as a value, which once shared an id. |
| ✅ | a function held in a **field**, on a class or an object literal, called through it. `f(x): number` is a method the dispatch table holds and `f: (x) => number` is storage; the checker says which, and asking the *type* instead cannot tell them apart `examples/callback-fields` carries it — a callback held in a field and called through it — and `examples/callbacks` the inline-arrow forms that `forEach`, `map` and `reduce` take. |
| ✅ | recursion `examples/a-nested-function-that-captures` carries the recursive case, where the name is bound to the receiver inside its own body so it can call itself. |
| ✅ | `async`/`await` — under both providers, on a **function, a method or an arrow**, instance or static | a method's receiver is a parameter, so it goes into the suspended frame beside the others and comes back on resumption. Methods were refused for a reason that had stopped being true — *"`Promise<T>` has no representation"* — at **161 occurrences, 63 distinct sites** in `runtime/node`, the largest single language refusal there. Record 0120. **Arrows were the third site and did not work at all until 2026-09-13**: `lower_closure` never called `begin_async`, so an `async` arrow had no promise and the whole construct followed from that — `async (a) => a + 1` emitted invalid C casting a `double` to an `NtsPromise *`, and an `await` *inside* one reported `a top-level await`, because `async_result` being `None` is what module scope looks like from inside `lower_await`. The same two sentences an async generator produced the day before, from the same omission, in the third of three call sites. **Found from the far end**: the JVM lane reported four closures stored where a signature layout was declared and pointed at `relate_closures_to_signatures`, which was innocent — an async arrow's `call` answered `f64` where the declared signature said `Promise<f64>`, so no layout claimed it and it got no base. Three probes built up from a working case all passed, because none of them varied `async`; the reproduction came from `stream`'s `tap` verbatim. `examples/an-async-arrow`, **232 cases across eight exports** on C, LLVM and the JVM. Corpus, measured: `a top-level await` goes **3 → 0** across `stream`, `fs` and `http` and total `NTS1001` roots move in **no** module — three cleared and three behind them surfaced. The other spelling never occurred at all. A construct that did not work is worth three roots here, which is a fact about a corpus that had already routed around it **And `return g()` — adoption — as of 2026-09-17.** Settling a promise *with* a promise was refused: the outer does not take the inner promise as its payload, it takes the inner's eventual settlement, **two microtasks later**, and both halves are observable. Before the refusal it was a clang diagnostic against generated code, because an `NtsPromise *` does not go where a `double` is wanted. `nts_promise_adopt` is a runtime operation in all three runtimes — C, the JVM's `NtsPromise.adopt`, and an LLVM signature — and the two hops are the specification's two jobs: `NewPromiseResolveThenableJob` subscribes, and the subscription's reaction settles. **Measured against node before it was written**, with a chain of eight microtasks to count against: `tick0 tick1 AWAIT tick2 ADOPT tick3`, so a `return g()` whose `g()` has already settled lands exactly one tick after a `return await g()` would. `examples/a-promise-settled-with-a-promise` is 174 cases across six exports agreeing with node on all three backends, and the arm that earns it is `whichFirst`: started first, lands second. **Collapsing the two hops into one subscription makes that arm answer 12 where node says 21, and the example fails with 29 disagreements** — every other arm agrees under either count, which is why that one exists. Adoption refusals across `stream`, `fs`, `http` and `net` go 9/12/9/7 to 0/1/0/0; the one that remains is a genuine payload mismatch — `Promise<Buffer>` and `Promise<unknown>` are assignable in TypeScript and are a pointer against a tagged value here — and refuses by name, because the forward copies one `NtsValue` across and a disagreement would put the inner's spelling in a slot the outer's readers unpack differently |
| ✅ | `new Promise(executor)` where the executor is an arrow written at the call: it runs synchronously, so its body is lowered where the promise is built and `resolve(v)` *is* the fulfil. No closure, nothing captured `examples/promise-constructor` carries it. |
| ✅ | a `throw` in an `async` function rejects the promise it owns, the way its `return` settles it — `examples/a-throw-that-stays-in-its-function`, whose `rejecting` throws inside an `async` function |
| ✗ | `.then`, `.catch`, `.finally` **as methods on a promise** | **an absent row, not a wrong one — added 2026-09-14 after probing the ✅ beside it.** `async`/`await` is answered and this is not: every receiver refuses with `NTS1001 a method call on something without methods`, measured on one binary with the receiver as the only variable — `Promise.resolve(n).then(...)`, `new Promise(r => r(n)).then(...)`, an `async` function's returned promise, and a `Promise<number>` **parameter**. `.catch` and `.finally` refuse identically. **Reachability does not save it**: a `.then` in a function no export reaches still refuses, so this is not pruned away. What *does* work is everything that goes through the frame rather than the object — `await p`, `await new Promise(...)`, `await Promise.all([...])` — which is why the neighbouring rows are ✅ and why this one was never noticed. **Demand is not zero: 51 `.then(`, 7 `.catch(`, 1 `.finally(` in `runtime/node`**, concentrated in `stream` (35) and `fs` (8), both of which build addons — so those sites are refused individually while the module still emits, which is exactly how a module publishes 2 names and reads as working. A promise is a frame here, not an object with a method table. **Scoped 2026-09-14, and it is not the desugar I called it.** The dispatch point is easy: `ManagedType::Promise(Box<HirType>)` exists, so the receiver *is* typed, and `lower_method_on` already branches on Array, Map/Set, Date, Buffer, DataView and Symbol before falling through to this refusal — a Promise arm sits beside them. The runtime primitive exists too, with exactly the right contract: `nts_promise_subscribe(NtsPromise *, NtsTask reaction)`, *"run `reaction` when it settles, or on the microtask queue if it already has. Already-settled does **not** run inline: that would change the tick count, which is observable through interleaving."* **And no backend emits it** — every call is inside `nts_runtime.c` or its own tests, so `await` does not use it either, and `hir::runtime`'s table carries four promise helpers of which this is not one. So the row closes one of two ways and neither is local: expose `subscribe` in `hir::runtime` and build an `NtsTask` reaction from a TypeScript callback — but that table is asserted to be *the single answer about what a `Callee::External` can be*, so C, LLVM and the JVM must all answer for it — or synthesise the HIR that `(async () => f(await p))()` would have produced, which adds no runtime surface and means generating a frame where the source has none. **Demand measured again in refusals rather than in source sites, 2026-09-14, and it is smaller than the site count suggests.** Emitting `stream` gives 1923 diagnostics across 1491 sites in 99 files; `a method call on something without methods` is **20 of them, eleventh by message**. Stream's 35 `.then(` do not all reach lowering — an enclosing function that refused earlier takes its callees with it. So `.then` is about 1% of what stops `stream`, and what actually stops it is unrepresentable types (a union carrying a close sentinel 63, a `WeakRef` array 58, `AsyncIterable` 29), `a call inside a `try`, whose `throw` would not reach this handler` 52, and `Promise.withResolvers` 28 — which has its own ✗ row. Recorded so this row does not borrow rank it has not got: 59 source sites is real, and it is not the same number as 59 refusals removed. **Re-measured by the node lane on roots rather than diagnostics, and it is smaller again: 2, not 20.** Counting only NTS1001 *roots* in `stream`'s own sources — 414 of them, with 194 NTS1003 cascades excluded — `.then` is `end-of-stream.ts:419` and `iter/share.ts:103`, and nothing else. My 20 was diagnostics including cascades, which is the looser unit. **And `stream` is not one of the five silent-zero modules** (those are `child_process`, `cluster`, `console`, `events`, `timers`); it publishes 2 names and its axis row is `271 files: 1 passed, 251 failed` — a real pass, not a hollow one. So the 35 sites and the 2 roots differ by 33, and the likely reason is that those enclosing functions are already declined for something else: **implementing `.then` would publish none of them**, it would move each to whatever refusal comes next. This ledger has been caught by exactly that once before, when removing what looked like the second-biggest chokepoint published zero exports. Do not price this row off 59 sites; the number that would settle it is a before-and-after on roots with the rest of the tree held still. **The 414 is pin-specific and the unit moved, noted 2026-09-14.** Re-run against a later compiler it is 423, and the cause is an improvement rather than a regression: `path` shows the same code going from three roots to five because the compiler stopped naming *symptoms* — a `new` with no constructor, a method with no declaration — and started naming the **cause**, a property of unrepresentable type, at every site rather than twice downstream. Better reporting, larger count. So root totals are comparable only within one binary, and the 2-of-414 ratio is the durable part of this row rather than either number. A second inflater is live meanwhile: the native ABI diagnostic fires at **call sites**, so one untagged declaration used four times reads as four roots, and a census taken mid-migration counts those in the same column as lowering gaps. **Corrected: they are not "debt".** The two `cluster` declarations behind those four roots are JS-only shims with no C prototype and no `.c` definition, and the landed vocabulary is `managed` and `intrinsic` only — both of which would be false for them. So the refusal is **correct and permanent** until a shim-only classification exists; what misleads is the wording, which advises a brand that cannot be applied, and the per-call-site count. |
| ✗ | an executor that is not an arrow written at the call, or a `resolve` used as a value rather than called (`new Promise(r => { saved = r })`) — both need a real closure over the promise |
| ✅ | a **`catch` that spans an `await`** — `try { await p } catch { … }`, including a bound reason, a `throw` and an `await` reaching one handler, two awaits in one `try`, nesting, a rethrow, and an `await` inside the handler itself. A rejection is an *edge into the handler* like a `throw`, and the block it leaves does not exist when the lowering runs — `suspend` creates it on splitting at the `await` — so the handler and its arguments are settled at the lowering, into `OpKind::Await`, and read there. **89 occurrences across 17 sites** in `runtime/node`, and it was a wrong answer rather than a gap: `try { await failing() } catch { return -99 }` compiled, ran, and rejected. Record 0167 `examples/async-methods` carries `async` methods, which were refused for a reason that had stopped applying; `examples/async-unsupported` names the parts of `async` this lowering still refuses. |
| ✅ | a **`finally` that spans an `await`**, with a `catch` beside it or without. With one it already worked once un-refused: the rejection reaches the handler and the handler's normal exit runs the `finally`. Without one there was nowhere to go, so a handler is **synthesised where the source wrote none** — `try { … } finally { F }` becomes `try { … } catch (e) { F; throw e } finally { F }`, which is what explicit cleanup means. Built only where a rejection recorded itself, because a block with no predecessors is one the verifier rejects. **29 occurrences across 6 sites**, evenly split between the two shapes, and it was a wrong answer: node runs the `finally` and this did not. Record 0171 `examples/async-finally` carries it. |
| ✅ | type predicates (`x is T`) and `asserts x is T` — **run against node 2026-09-15, 87 cases across 3 functions, agreed on every one.** `examples/a-type-predicate-that-narrows` carries a guard taken both ways, its negation (which narrows the *other* arm in the `else`), and an `asserts` predicate, which narrows for the rest of the scope rather than inside a branch. The previous citation was `examples/advanced` — where the only guard is `isFish(pet: Fish | Bird)`, taking an object, so that example is one of the **nine the gate reports as having "compared nothing"** and no case had ever been compared. The row was true and its evidence was the syntax being accepted. See §16: the narrowing reaches lowering through `node_types`, not through `SignatureRecord::type_predicate`, which has no reader. |
| ✅ | rest parameters | the call gathers its trailing arguments into the array `examples/rest-parameters` carries the ordinary form, `function f(...xs: number[])`. |
| ✅ | calling a function held in an **optional** property — `hook.init?.(…)` written as a guard and a call | not the same slot as a union with `undefined` in it, which is why one lowered while the other did not: a nullable reference is a pointer, and an optional property has a third state — *absent*, as against present-and-`undefined` — so it erases. The licence to unerase is the checker's narrowing, and it is asked of the **type** rather than the representation, because `F` and `F \| undefined` are both a pointer and a width test would admit the un-narrowed case. Unguarded still refuses: node throws `TypeError: … is not a function` there and a null call is not that. `emitInit` compiles because of this. Record 0291 — `examples/an-optional-chained-method-call` |
| ✅ | `parseInt` and `parseFloat` | neither is `Number(s)`, and the difference is that both **stop at the first character their grammar does not admit**: `Number("12abc")` is NaN and both of these answer 12. `parseFloat` is not `strtod` on the whole string either — `parseFloat("0x10")` is 0 where `strtod` reads a hexadecimal float and answers 16, `"inf"` is NaN where `strtod` accepts it, and `"1e"` is 1 because an exponent needs a digit after it. The longest admitted prefix is measured first and `strtod` is handed only that, because rounding a decimal string to the nearest double is what it is for. `examples/parse-int` and `examples/parse-float` |
| ✅ | `encodeURI`, `encodeURIComponent`, `decodeURI`, `decodeURIComponent` | a pair of pairs whose members differ only in a character set, so one lowering with two flags rather than four copies of the part with the edges in it. `decodeURI` leaves a reserved character **escaped** — it exists to leave a URI's structure intact, and decoding its separators would change what the string means. Both directions **throw `URIError`** on input the other could not have produced: a truncated or non-hex escape, an overlong encoding, a surrogate in UTF-8, a code point past `U+10FFFF`, an unpaired surrogate on the way out. The overlong case is the one worth not being relaxed about — a second spelling of a character is how a check on the decoded text gets bypassed — and it is why `nts_string_from_utf8`, which substitutes `U+FFFD`, could not be reused. A runtime function here cannot throw, so the C answers `NULL` and the lowering raises, the same split `repeat` makes for its `RangeError`. `decodeURIComponent` gates `querystring.parse`. `examples/uri-encoding` |
| ✅ | the provided **error classes** — `Error`, `TypeError`, `RangeError`, `URIError`, `SyntaxError`, `EvalError`, `ReferenceError` | a list rather than one class because they are distinguishable at run time and code that branches on which error it caught is ordinary. The position in the list **is** the class's identity as a value, so it is appended to and never inserted into. A class absent from it does not merely fail where it is thrown: it refuses its caller and its caller's caller, which is why the two cheapest were added before something expensive was found behind one. The napi wrapper used to keep its own copy of the list with its own arity in the type and now reads `hir::PROVIDED_ERROR_NAMES`. `examples/the-provided-error-classes` `examples/errors` states the fact the row rests on: `Error` is a class this compiler *provides* rather than reads. |
| ✅ | a generic function **no call pins down**, and one a module **exports** and nothing instantiates | not a feature but a diagnostic, and it belongs in this table because its absence read as one. With no instantiation `function_copies` answers with an empty vector, no copy is emitted, and nothing wrote a diagnostic anywhere — so the cascade said "calls X, which was refused above" with no refusal above. `asRequest` in `fs` sat at the head of the node profile for a day carrying 26 such lines while being invisible to every census, because a census reads diagnostics. It now names its type parameter at its own declaration `examples/interprocedural` carries the contrasting case, where nothing is exported so every caller is inside the compiled program and the parameters can be pinned. |
| ✅ | a rest parameter of **fixed arity** — `...args: [number, string]`, and `...args: A` where the instantiation pins `A` to a tuple | not variadic at all, and lowered as one parameter per position rather than one array, so it costs what the same parameters written out would. The arity used to live in three places — the call site, a closure's synthesised `call`, and the declaration — and only the declaration built an array; a parameter-list mismatch is not a diagnostic, so it came out as invalid HIR reported against the callee. A **generic** rest needs its copy to carry the arity as well: `[number]` and `[number, number]` both represent as an array of `f64`, so both spelled `[f64]` and one copy served every arity, which is harmless for an array and a miscompile for positional parameters. `examples/a-fixed-arity-rest-is-positional` guards both halves and the variadic control. Record 0287 |
| ✅ | a rest parameter written as a **union of tuples** — `...given: [] \| [a: string, b?: URL]` | how this tree asks "was I called with no arguments at all", and what makes `given.length === 0` a type the checker can narrow. 13 sites across 4 modules. Positions that agree keep a concrete element and pay no tag test; positions that **disagree** are *erased*, and a read at a constant index comes back through the tag, licensed by that position's declared type. The count stays exact because a rest is gathered into a real array — `URLSearchParams#set("a")` throws where `set("a", undefined)` does not, and six sites compare `given.length < 2`. Records 0282 and 0285 `examples/a-rest-parameter-written-as-a-union-of-tuples` carries the form, and `examples/a-rest-parameter-whose-positions-disagree` the case where the positions do not line up, which is what decides whether it is representable. |
| ✅ | `function` expressions that do not bind their own `this` — the same closure an arrow is, with the same captures. One that *does* use `this` is still refused, and that is the whole of the difference `examples/this-in-a-field-initializer` carries the other side of the line this row draws — a field initialiser whose value is an arrow that *does* capture `this`. |
| ✅ | closures over a variable something **assigns to** — the variable moves into a cell `examples/captured-by-reference` carries it — a closure over a variable something writes to. |
| ◐ | a closure over a `for` loop's own variable, which JavaScript rebinds per iteration | **the common shape landed 2026-09-13; a body that writes the variable, and `var`, still refuse.** It was established on 2026-09-12 that this was refused rather than silently wrong, and the probe for that is still the right one: four closures over `let i` sum to `0+1+2+3 = 6` under per-iteration binding and `4*4 = 16` under one shared binding, and node answers 6. **Copying is exact here rather than an approximation.** The specification copies the binding before each iteration and runs the increment in the copy, so iteration k's binding keeps iteration k's value for ever — and the value `i` holds where the closure is built *is* that value. The old rule reached the opposite conclusion by asking whether the name was written **anywhere**, and a counter is written by its own `i++` in every loop ever written, so it refused every loop to catch the rare one. It now asks whether the loop's **body** writes it. `examples/a-closure-over-a-loop-variable` is 116 cases across four functions on C and LLVM, against 29 across one before. **The arm that earns it is `deferredOne`**, which calls its closure after the loop: value capture gives 0 and one shared cell gives 3, where every immediately-called arm agrees under either. Without it the example would pass under both implementations. What still refuses: a body that writes the variable — `i += 10` after the capture lands in the binding the closure holds, so node answers 10 and a copy answers 0 — and **`var`**, which has one binding for the whole loop. That second one is the row's own earlier sentence becoming load-bearing: this refusal used to cover `var` by not asking which keyword wrote it, recorded then as an over-refusal costing nothing with seven ambient `var`s and none in a loop beside it. It was the only thing between `var` and a wrong answer once `let` was narrowed, and nothing said so. A shared cell is probably right for `var` and is unmeasured, which with zero sites is not a reason to stop refusing it. `blockers/a-closure-over-a-loop-variable` and `blockers/a-closure-over-a-loop-var` hold the two, each with the same program one keyword or one statement different |
| ✅ | a closure written *above* the declaration of a local it reads — **no example writes one**, so this rests on the first clause of ✅ alone |
| ✅ | generators (`function*`, `yield`) | the `async` state machine with a different protocol: the element goes in the frame and the suspension is an ordinary `return`, because what resumes it is the caller standing there rather than the event loop. There is no `Generator<T>` object — the **frame is the iterator** `examples/generators` carries them, walked by a `for...of`; `examples/generator-unsupported` carries the three things a `function*` is still refused for. |

### A written variable moves into a cell, and the cell is usually not on the heap

Escape analysis answers a store by asking about the *container*: what goes into
one is reachable from it and no further. So a cell held only by a closure that
does not escape does not escape either, and the whole pattern allocates nothing:

```c
NtsObj_Cell0 v2_frame;        /* the cell */
NtsObj_Closure0 v4_frame;     /* the closure holding it */
v4->total = v2;               /* 0 calls to nts_object_new */
```

Only a container **this function allocated** can confine what goes into it. A
parameter is already reachable by the caller, so `h.b = new Box()` inside
`fill(h)` puts the box where the caller can see it however local `h` looks from
in here. A unit test holds that case, because getting it wrong is a pointer into
a dead frame rather than a slow program.

Measured: 225 → 209 heap allocation sites across the examples. Across the node
profile it is 120 → 120, and that is the honest number — the profile's objects
are callbacks it registers and results it returns, which escape for real.

### A written variable moves into a cell, and only then

JavaScript closures capture the *binding*. For a name nothing writes to that is
the same thing as capturing the value, capturing the value is free, and that is
still what happens — it is the common case by a wide margin and it allocates
nothing.

For a name something writes to the two differ, and a program can see it:

```ts
let called = false;
const onDestroy = () => { if (called) return; called = true; };
```

Both sides have to see one `called`. So it moves into a one-slot cell, the
function and the closure both hold a pointer to it, and every read and write
goes through it. Parameters too — `callback = asRequest(callback)` before a
closure reads it is common in the profile, and missing that case emitted C that
did not compile rather than a refusal.

A closure over a **`for` loop's own variable** is captured **by value** as of
2026-09-13, which is exact rather than approximate: JavaScript copies the
binding before each iteration and runs the increment in the copy, so iteration
k's binding keeps iteration k's value, and that value is what `i` holds where
the closure is built.

Two shapes still refuse, each by its own message. A body that **writes** the
variable — the write lands in the binding the closure already holds, so a copy
is wrong. And **`var`**, which has one binding for the whole loop and so must
hand every closure the value the loop ended on. The old rule refused all three
by asking whether the name was written anywhere, which a counter always is.

A `let` in the loop *body* is a different declaration each time round and gets a
cell each time round, which is right without special handling.

### What a closure does not capture

A name that is reached *by name* is never captured, because there is one of it
for the whole program and copying it into a closure would be storage for
nothing: a function, a class, an import, a type, and anything at **module
scope**.

The last two were missing and it cost a whole row. `(callback as
Callback<Stats>)` mentions a type alias inside an arrow; `const BASE64 = "..."`
and `const weakSetHas = WeakSet.prototype.has` are module-scope constants. All
of them have symbols and are declared outside the arrow, so all of them looked
like captures, and the closure was refused for finding no value for a name that
never had one.

The refusal said *"a name from more than one scope up"* — 41 sites of it, and
27 were nothing to do with scope depth. It is 1 now, and what replaced the rest
are refusals at the *read* that say what the thing is: a module-scope `let`
holding a function, an enum, a builtin this compiler does not provide. A refusal
belongs where it can name the cause.

The one that remained was real, and is now done:

```ts
const onListening = () => { ...cleanup...; };
const cleanup = ...;
```

Legal, because the body runs later. There is no value to copy where the closure
is built, so the name goes through a cell whether or not anything writes to it,
and the cell is opened in the function's **entry block** — it has to dominate
both the closure that reads it and the declaration that fills it, and those can
be in different branches, so that is the one placement that always holds.

The cell is empty until the declaration runs, and a body that runs in that
window would read a zero where JavaScript throws a `ReferenceError`. This
compiler has a `throw` now, but not one the *runtime* can raise: `nts_uncaught`
prints and exits, and nothing below the lowering can reach a handler. So such a
cell carries a `ready` flag and stops the program instead:

```
nts: `later` was read before its declaration ran
```

Only a *closure* can reach that window: TypeScript rejects a direct use before
declaration in the same scope. So the flag exists only on cells that are read
from above their declaration, the check appears only inside closure bodies, and
an ordinary captured-and-written variable carries neither — its struct is the
header and the value, as before.

### A function as a value costs one static object, and nothing where it is not used

`nextTick(finish, stream)` needs `finish` as a value. The answer is a closure
with no captures whose `call` forwards to `finish`, emitted once:

```c
static NtsObj_Closure0 nts_fnval_NtsObj_Closure0 = {{&nts_desc_NtsObj_Closure0, NTS_IMMORTAL, 0, 0}};
...
    v1 = &nts_fnval_NtsObj_Closure0;      /* no allocation */
    v3 = inc(v0);                          /* an ordinary call is still an ordinary call */
```

One instance rather than one per mention, because `finish === finish` has to be
true and an event emitter removes a listener by exactly that comparison. It
forwards rather than re-lowering the declaration's body, so a recursive function
used as a value still has one definition and recurses into it.

Deliberately **not** extended to a non-capturing arrow: `(() => 1) === (() =>
1)` is false in JavaScript — two evaluations make two objects — so folding those
to one instance would answer a comparison wrongly. `examples/function-values`
holds both halves.

The wrapper exists only for functions something actually passes. A program of
ordinary calls emits no closure struct, no dispatch slot and no table at all.

## 4. Classes and objects

| | | |
|---|---|---|
| ✅ | fields: public, `readonly`, `private`, `protected`, `static`, `#private` `examples/a-static-field-is-storage` carries the static one read and written through the class name, `examples/field-defaults` the initialisers that run at construction, and `examples/modifiers-on-a-field` the declaration carrying two or more modifiers, which once lost its initialiser. |
| ✅ | field initializers, constructors | **a class's own initialisers are emitted inside its own constructor as of 2026-09-12** — at the top when it has no base, immediately after `super()` when it has one, which is where JavaScript puts them. They were at the `new` site, every class's before any constructor ran, and that one placement was wrong three ways: a derived initialiser could not see what `super()` stored, a class built only through the napi wrapper ran none of them, and an optional property's presence mask inherited both. What the allocation site keeps is the classes *below* the one whose constructor it calls — those declare none of their own, and they go **after** the call, because an implicit constructor is `super(...args)` followed by this class's initialisers. `examples/a-field-initialiser` is 174 cases across six functions agreeing with node on **all three backends**, every value derived from the argument so no leftover and no folded constant can be right by accident |
| ✅ | a **derived class's field initialiser sees what `super()` stored** | `class D extends B { y = this.x + 10 }` reads the `x` the base constructor wrote. It did not: **28 of 29 cases against node**, answering `nan`, because every class's initialisers ran before any constructor. **The optimiser hid it for one probe** — the first version used a constant base value and agreed with node on all 29 cases. Reading an uninitialised member is undefined behaviour, so the same emitted C answers `10` then `7.9e+08` at `-O0` and `11` — node's answer — at `-O2`: a release build agreed because clang chose to, not because the program computed it. A first explanation of stack reuse was offered and disproved by dirtying the stack. Both levels answer 11 now. `blockers/a-derived-field-initialiser` is the guard and runs through the napi boundary, which is the only place the second defect was visible |
| ✅ | methods, `get`/`set` accessors, `static` methods `examples/accessors` carries them, and states the thing that makes them worth a row: an accessor looks like a property and **is** a call. |
| ✅ | an accessor a subclass **overrides**, dispatched by what the receiver is. `accessor_callee` returned a name and both its call sites wrapped it in `Callee::Direct`, so `b.plain` on a `Narrow` typed `Base` ran `Base`'s getter and answered 1 where node answers 2 — a **wrong answer**, on getters and setters alike and on both spellings of the member. The hierarchy had the slot the whole time; nothing in the corpus overrode one, so nothing read it back. An accessor nobody overrides is still a static call, so the cost is confined to the members that need it. Record 0162 — `examples/accessors`, where `Overriding` and `Middling` both override `Reading.plain` and `Doubling` overrides `Storing.value` |
| ✅ | a **class used as a value** — `value === Error`, and `cond ? TypeError : RangeError` compared. **Not `err.constructor === TypeError`**, which this row named until 2026-09-12 and which is refused: `` `constructor`, which `RangeError` does not declare ``. The token is comparable; reading `.constructor` *off an instance* is a member this compiler does not put there, and is a separate row. One immortal object per class, the same one wherever the name is written, `typeof` `"function"`, compared by address: the same thing a named function used as a value already is. The seven provided error classes; **1,865 occurrences across 88 sites** in `runtime/node`, the largest single refusal there. Record 0162 `examples/class-values` carries it as a value rather than a type, and `examples/a-class-token-meets-its-own-typeof` the case where the token is stored where its own `typeof` is declared. |
| ✗ | **calling** a class value — `TypeError(m)`, which JavaScript makes `new TypeError(m)`. The token holds nothing and would need a `call` that constructs. **Demand remeasured 2026-09-13 and the row's “nothing in the profile asks for one” holds**, with the instrument checked both ways rather than quoted: 239 lines of `runtime/node` name a provided error class as a callee and every one writes `new`, and the 239-to-0 drop across the `new` exclusion is what shows the pattern ran on real data rather than matching nothing. **What the probe found instead was the refusal.** It read `NTS1001 `TypeError`, a builtin this compiler does not provide` — false twice over, since the class is the second entry of `hir::builtin::ERRORS` and a reader sent there finds nothing missing to add. The arm above it already carried the comment “two different failures wore one sentence”; this was a third, and it now says `a class this compiler provides, called without `new``. Only a provided class can reach that arm — a class the program declares is TS2348 before the compiler sees it, measured rather than assumed — so the `PROVIDED_ERROR_NAMES` test is the whole of it. `blockers/a-provided-class-called-without-new` holds it with two controls: the same class **with** `new`, which compiles, and the call bound to a name first. Same machinery as the row above: both want a token carrying an instance descriptor and a constructor, and with zero sites asking for either they are one feature, not two |
| ✗ | a **union of two class values** — `cond ? TypeError : RangeError` | the diagnosis below is right and was nearly discarded as stale. Comparison **agrees on C and LLVM** — **116 cases across four exports as of 2026-09-13**, bound, returned and tested against both arms — so checking those two reads as the feature working. (The figure stood at 87 across three until it was re-run rather than re-quoted; the example grew an export and the row did not follow it. A count carried in prose is a second derivation of a fact the example already holds, and the two drift in exactly one direction.) The JVM declines it: `NTS4001 storing a `Ctor_TypeError` where a `Fn16__20` is declared`. The checker collapses the conditional to a *single* constructor type, so whichever token is not that type meets a slot declared for the other — **two genuinely different signatures rather than two ids for one**, which `signature_key` cannot relate and no `Layout.base` can either. A token that is a representation rather than an address would. Per-backend, so it stays ✗. **And the row was hiding a wrong answer that ran, found 2026-09-13.** Everything above is about comparing the token, which is right — `a-class-stored-and-compared` binds, returns and compares tokens and **now agrees on all three backends**, so the JVM half is closed. What it never does is call `new` on one. `const C = (n & 1) === 0 ? TypeError : RangeError; new C("x").name.length` answered **10 where node answers 9** — a `RangeError` built where the program chose `TypeError` — on C *and* LLVM, 13 of 87 cases. The class comes from `type_of(id)`, the type of the `new` expression, which the checker gives as a union and `widened` collapses to one arm. `constructed_from_a_value` had guarded exactly this since `a-new-through-a-class-value` landed, and sat **below** `lower_new_provided` — so a class this compiler provides, having no constructor to call, took a different route to the same gap and arrived under the guard. Moved above it; the refusal costs one site per module. So this row is two features: comparison, which works on all three backends, and construction, which is `blockers/a-new-through-a-class-value` and wants the token to carry its own constructor.
**`a-class-stored-and-compared` was called "the same refusal" here and was not** — it closed on 2026-09-12 with a base, which is exactly what this row says cannot work. The difference is the number of signatures a token has to reach: one there, two here. That example's token reaches `Fn3__1` and nothing else, so a base relates it; a conditional's reaches both arms' slots and no single base can. The sentence above is about *this* row and was being read as being about both |
| ✅ | inheritance, `override`, `super`, virtual dispatch `examples/inheritance` carries it, under the claim that inheritance costs what it has to and nothing more. |
| ✅ | `abstract` classes and their implementations `examples/abstract-methods` carries the signature with no body, and why it had to be lowered rather than skipped. |
| ✅ | `implements` — `examples/interface-dispatch` |
| ✅ | member names: bare, quoted, `["bracketed"]`, `[0]` `examples/computed-members` carries the bracketed spelling: a member declared with brackets around a literal. |
| ✅ | extending a typed array when the subclass adds no storage `examples/typed-array-subclass` carries it, and `examples/super-on-a-typed-array` the `super.fill(...)` / `super.subarray(...)` half. |
| ✅ | parameter properties (`constructor(public x: number)`) | two things wearing one syntax — a parameter, and a member initialised from it. The checker already reported the member, so the layout always had the slot; only the assignment was missing, emitted before the body because that is where JavaScript puts it and the body may read `this.x` on its first line. **Node cannot run this in strip-only mode** — a parameter property is not erasable, so the oracle refuses the program rather than disagreeing with it. The differential passes `--experimental-transform-types`, which is what `tsc` does. **No benchmark row, and the reason is measured rather than argued**: the sugared and desugared forms emit *byte-identical* C, so a row would compile the same program twice and report 1.00x by construction — `examples/a-class-stored-and-compared`, `constructor(public n: …)` |
| ✅ | `abstract` **methods** — a signature with no body, terminated as unreachable. The declaration is lowered rather than skipped because a call through `Shape#area` takes its function-pointer type from it `examples/abstract-methods` carries it, and records why the declaration had to be *lowered* rather than skipped: a call through `Shape#area` is an indirect call and the backend takes the function-pointer type from the declaration. |
| ✅ | **generic classes** — one copy per instantiation, and every piece of the machinery for that already existed. What was missing was the ability to find the class's type *parameters*: `generics::instantiations` looks for the declaration among the types its symbol declares, in order to zip its arguments against each instantiation's, and only considered types the frontend had **decomposed**. `class Box<T> { v: T }` is not decomposed, because `v` has no width — so the declaration was never in its own group, no declaration was found, and every instantiation was dropped with it. Which member of the group is the declaration is also not decided by shape: a generic function naming `Entry<B, A>` gives a second all-parameter type, and picking it maps `A` and `B` rather than `K` and `V`. The class declaration node's own type is the authority. Also: an instantiation inherits the declaration's **base** (the checker answers `getBaseTypes` for a declaration, and `Box<number>` is a reference to one), and a `static` member is **one** function however many copies there are, named without the instantiation — TypeScript forbids it from referencing a class type parameter, and `Factory.of(n)` names no copy to choose between `examples/generic-classes` carries it, and `examples/generic-classes-unsupported` carries the twin that typechecks and for which no copy can be made. |
| ✗ | a generic class **extending a generic one at its own type parameter** (`class Boxed<T> extends Base<T>`) | **the prerequisite is transitive specialisation, measured 2026-09-12 rather than assumed.** `hir::generics::instantiations` scans the types the *checker interned* — it is a one-shot scan, not a fixpoint over copies. `nts types` on `class Boxed<T> extends Base<T>` shows `Boxed<number>` decomposed as an `Object` with its properties, and every `Base` left `Structured`: the checker flattens the base's members into the derived instantiation and never materialises `Base<number>`. So the member lookup finds no type and refuses as `a member of `Base`, a class this compiler has no type for`. Closing it means **deriving** `Base<number>` from `Boxed<number>`'s arguments — a copy demanding another copy, which is the fixpoint the queue names and which no amount of work on this row alone reaches | **Priced 2026-09-13 and deliberately not built.** The prerequisite is real and the snapshot has what it needs — `base #6 -> [18]` records that `Boxed` extends `Base<T>` at its own parameter, and `Boxed<number>` is materialised as an `Object` whose inherited members are already flattened. What is missing is a `Base<number>` for the inherited method bodies to be emitted against, and the checker never makes one: the base clause's type is `Base<T>`, all-parameter, which `instantiations` correctly reads as a *declaration* rather than an instantiation. So a fixpoint needs **synthetic type ids** — the shape `provided_error_type` uses — and with them the layout, the member lookup and the emission all have to accept a type the snapshot does not carry. Against that: `a member of \`X\`, a class this compiler has no type for` is 5 things / 23 sites / 12 modules and **clears nothing measurable** (record 0320), `a function returning the type parameter \`X\`` is 4 things / 5 sites, and the row below is unreached. Reordered out on the corpus's own evidence, which is what the standing queue asks for rather than a judgement about difficulty.
| ✗ | a generic **method** on a generic class (`map<U>(f: (t: T) => U): U`) — one copy of the class is not one copy of the method: `U` is decided per call site and the class copy per `new` **Also transitive**: `Holder<number>` is a copy and `mapped<U>` wants a copy per `U` *within* it, so it is a copy of a copy. Refused as `a function returning the type parameter `U``, measured 2026-09-12 | **Priced 2026-09-13 and deliberately not built.** The prerequisite is real and the snapshot has what it needs — `base #6 -> [18]` records that `Boxed` extends `Base<T>` at its own parameter, and `Boxed<number>` is materialised as an `Object` whose inherited members are already flattened. What is missing is a `Base<number>` for the inherited method bodies to be emitted against, and the checker never makes one: the base clause's type is `Base<T>`, all-parameter, which `instantiations` correctly reads as a *declaration* rather than an instantiation. So a fixpoint needs **synthetic type ids** — the shape `provided_error_type` uses — and with them the layout, the member lookup and the emission all have to accept a type the snapshot does not carry. Against that: `a member of \`X\`, a class this compiler has no type for` is 5 things / 23 sites / 12 modules and **clears nothing measurable** (record 0320), `a function returning the type parameter \`X\`` is 4 things / 5 sites, and the row below is unreached. Reordered out on the corpus's own evidence, which is what the standing queue asks for rather than a judgement about difficulty.
| ✗ | a generic class whose instantiation is **inferred rather than written** — `new AbortableAsyncSource(source, signal)` with no type argument. `generics::instantiations` finds the copies from the checker's instantiated *types*, and an inferred one is there; what is missing is that the class declaration's own type is reached before them. **Those twenty sites are the row below's, not this one's — checked 2026-09-13.** A minimal pair says the construct works: `new Box(n)` with no type argument, `new Source([n], 3)` where `T` comes from `T[]` rather than from a bare `T`, and an **exported** generic class instantiated by inference all lower and agree with node across 116 cases, against a written-out `new Box<number>(n)` control. What still refuses in `async_hooks` is `AsyncLocalStorage` (10 sites) and `StorageContextEntry` (4), and **neither is instantiated in its own module at all** — there is no `new` of either anywhere in it — so what those sites lack is not an inferred type argument but any instantiation to copy from, which is the row below. The two rows had been sharing one set of sites, attributed to the one whose name fits the source text rather than to the one whose condition holds. `AbortableAsyncSource` was not re-confirmed and is not claimed here. So this row is **unreached by anything measured**, and a fixture that instantiates by inference in the same compilation cannot fail on it |
| ✗ | a generic class **exported but not instantiated in its own compilation** — a copy needs type arguments and only a caller supplies them, so a library compiled alone emits nothing for its own generic classes. **23 sites across 5 classes in 12 modules, measured 2026-09-13; the 129 was stale by a factor of five.** `refusal-census.mjs --top=204` reads `a member of \`X\`, a class this compiler has no type for` at 5 things, 23 sites, 12 modules — and the `--top=` is load-bearing, because the table prints 25 of 204 roots and used to say so nowhere. 14 of the 23 are `async_hooks`: `AsyncLocalStorage` 10 and `StorageContextEntry` 4, with no `new` of either in that module. Those are the sites the row above claims, and they are this row's. The class is not dead: a consumer instantiates it. **And it clears nothing, which is the reason not to build it.** Measured 2026-09-13 rather than inferred from the count: `async_hooks` carries 14 of the 23 sites, and that module has **zero** `NTS1003` cascade refusals — nothing downstream refuses because of them. Its twelve declined exports name neither class; the one "class whose constructor was not compiled" there is blocked by `ERR_INVALID_ARG_TYPE` instead. So closing this removes 14 refusal lines, publishes no export, unblocks no function and changes no answer. The trigger is also **not** `new`, which the row's title says. A minimal pair: an exported `class Held<T>` with no mention refuses once per member, and adding a function that merely *names* `Held<number>` in a parameter position clears all of them — the checker interns the type and `generics::instantiations` finds it. What is missing is any concrete mention, not an instantiation. `AsyncLocalStorage<T = unknown>` suggests the cheap fix and the schema does not carry it: a parameter with a **default** has a canonical instantiation the language specifies, and `TypeKind::TypeParameter` holds a `constraint` and no default, so using it means a schema change and a tsgo fetch. Priced and declined on the yield above, not on the difficulty. Closing this means emitting a copy per instantiation found across a *program* rather than a compilation, or an erased fallback copy for the ones nothing here names |
| ✗ | a generic class constructing **itself at its own type parameters** (`swapped(): Entry<V, K>`) — under the copy's substitution that names `Entry<string, number>`, and the checker instantiates a class where the source names one **Also transitive**: `Entry<K, V>` is a copy and `swapped(): Entry<V, K>` demands a second derived from the first. Refused as `a function returning `Entry``, measured 2026-09-12 | **Priced 2026-09-13 and deliberately not built.** The prerequisite is real and the snapshot has what it needs — `base #6 -> [18]` records that `Boxed` extends `Base<T>` at its own parameter, and `Boxed<number>` is materialised as an `Object` whose inherited members are already flattened. What is missing is a `Base<number>` for the inherited method bodies to be emitted against, and the checker never makes one: the base clause's type is `Base<T>`, all-parameter, which `instantiations` correctly reads as a *declaration* rather than an instantiation. So a fixpoint needs **synthetic type ids** — the shape `provided_error_type` uses — and with them the layout, the member lookup and the emission all have to accept a type the snapshot does not carry. Against that: `a member of \`X\`, a class this compiler has no type for` is 5 things / 23 sites / 12 modules and **clears nothing measurable** (record 0320), `a function returning the type parameter \`X\`` is 4 things / 5 sites, and the row below is unreached. Reordered out on the corpus's own evidence, which is what the standing queue asks for rather than a judgement about difficulty.
| ✅ | a class used as a *value* (`C` itself, passed or returned) | **passing, returning, storing and comparing agree on all three backends as of 2026-09-12** — 116 cases across four functions in `a-class-stored-and-compared`, which was the JVM's last disagreeing example. The token is an address, and a token with no base now takes the signature layout it is *stored into* when there is exactly one; `token_base` gives it the base of its own `typeof` where the program declares that type, and the two coincide on some tokens and not others, which is what made the second look like the general rule. **Constructing through one is a different row and still refuses** — see `calling a class value` above, and the union two rows down. **Constructing through one was a wrong answer that ran**, until it was refused on 2026-09-12: `new C(n)` took its type from the *expression*, which the checker takes from the callee's declared type, so `function make(C: typeof Thing)` built a `Thing` and called `Thing__constructor` with the class argument discarded — `(void)v0;` in the emitted C. One class reaching the site is correct, which is why it was invisible; a second assignable class is built as the first, at the first's size, and `Other`'s constructor was never emitted. Two classes through one site disagreed with node on **18 of 58 cases** and produced a number for each. Refusing it was already the documented intent — the class-token lowering says `new` through such a value "still refuses, as `a computed constructor`" — and a *named* binding slipped past that check because it has identifier text. Building it needs the token to carry the instance descriptor and the constructor, which is the generator's resumption slot with a different member. `tooling/conformance/blockers/a-new-through-a-class-value`, 29 sites in `runtime/node` `examples/a-class-stored-and-compared` carries it, from node's documented `createServer({ IncomingMessage, ServerResponse })` — a caller substituting the message class, stored in a field. |
| ✅ | methods and getters on **object literals** | **landed 2026-09-17**, and three things had to meet. **The type a literal's members are lowered under is the type it is built at** — an `{ v, twice() {} }` assigned to an `interface O` lowered its method as `Type6#twice` while the call asked for `O#twice`, one side taking the literal's own checker type and the other the contextual one; both read `literal_object_type` now. **The hierarchy learns from the *type*, not from the literal node** — `const o = { v, twice() {} }` gives the literal expression one anonymous type and widens `o` to another, so a walk over nodes registers the first and the call site asks about the second; every anonymous object type carrying a member is registered instead. **And `__object` is a name that is not one** — TypeScript names every anonymous object type's symbol `__object`, so two literals each declaring `twice` both produced `__object#twice` and lowering refused the program with `DuplicateFunction`; `decompose.rs` already declines to publish those as nominal identities *for exactly this reason*, and the same rule now applies where a layout is named. `examples/a-method-on-an-object-literal` is 232 cases across eight exports on C, LLVM and the JVM, seven refusals on the pre-change binary, and `sameNameTwice` is the arm that holds the naming. `addons.sh` 24 of 24, 0 regressed; the `in an object literal` refusals go 7 to 0 in `stream`, `fs` and `http` |
| ✅ | a member keyed by a **symbol** (`[kRefed]`) — an ordinary field, not a map `examples/symbol-keys` carries it — a class member whose name is a symbol; `examples/symbol-values` is the different feature of a symbol used as a value. |
| ✅ | a **method** keyed by a symbol (`[kStep]() {}`, `[Symbol.iterator]() {}`) — the same name in all three places that decide it: the declaration names the emitted function, the hierarchy answers the lookup, and the call site does the looking. Only the declaration had a rule; the field half had worked all along because a layout takes its field names from the checker's members `examples/symbol-keys` carries it, as a class member whose name is a symbol. |
| ✗ | a member name the program computes from a value the compiler cannot see | **the boundary, measured 2026-09-13:** an **index-signature** type takes one and always did — `o[k]` on a `Record<string, number>` with `k` chosen at run time agrees with node, which is what `examples/in-on-a-record` guards. What refuses is the same expression on a type with **declared members**: `indexing `Named`, which is not an array`, and `indexing an object type, which is not an array` through an `as unknown as Record`. So the gap is not "a computed key" but "a computed key where the layout is fields rather than a table", and the two spellings of that are one cause. A probe that reaches only for a `Record` passes and measures nothing |

### `[kRefed]` is a field, not a property map

`node` keeps internal state off a class's public shape with symbol keys:

```ts
export const kRefed = Symbol("refed");
class Immediate { [kRefed]: boolean | null; … this[kRefed] = false; }
```

It reads like a property map and is not one. A `const` symbol at module scope is
*one* symbol, known at compile time, so `[kRefed]` is a field with an unusual
name and costs exactly what `_refed` would.

The snapshot already reported it, under TypeScript's own spelling —
`__@kRefed@2`, the description and the checker's id, which is the name the
checker does lookup by. What was missing was only the *access* side: it had the
variable's name, `kRefed`, and looked for a field called that.

The checker's id does not survive into this snapshot, so the match is on the
description, and two symbols sharing one description on one type is **refused**
rather than guessed — the case that would otherwise pick a field silently.

Measured, because "costs exactly what `_refed` would" is a claim and not an
observation. The `symbol-keys` row writes both spellings through one object in
one loop: **1.02x C++ and 0.19x node**, where the C++ reference is a plain
struct with four fields. A property map would have separated the two halves;
they do not separate. `tooling/memory/cases/symbol-keys` is the same claim on
the other axis, at ideal 0 and allocated 0.

The `symbol` type as a runtime value is **there now**, and it was the largest
single number in the profile — the paragraph this replaces predicted the design
exactly and it is the design that landed: a tag beside `NTS_TAG_OBJECT` and an
interned cell whose address is its identity, after which `string | symbol` is
an ordinary erased union.

`NTS_TAG_SYMBOL` sits between `FUNCTION` and `OBJECT`, which is the only slot
the two orderings allow: outside `tag >= OBJECT`, or `typeof sym` answers
`"object"`, and inside the contiguous reference range `STRING ..= OBJECT`,
because a symbol *is* a reference. Both are now compile-time assertions beside
the table rather than prose beside it.

**The map needed no code at all.** `nts_hash_key` already hashed an
unrecognised reference by its pointer and `nts_key_eq` already compared one by
its pointer, and for a symbol that is exactly right rather than merely adequate.
Two fallbacks written to be general, load-bearing for a type that postdates
them.

What it was worth, measured: **2170 → 2043** distinct refusal sites, and the
category it was aimed at fell 393 → 82. Of those 393, **318 were one property**
— `EventEmitter._events`, whose type is `Map<string | symbol, Registered |
undefined> | undefined` and which every class extending `EventEmitter`
inherits. The key was the sole blocker, checked rather than assumed:
`Map<string, A | B>` and `Map<string | number, V>` both lowered before this.

| | | |
|---|---|---|
| ✅ | **`object`** as a type — a parameter, a field or a local. An erased value, because "some object, which one is not known" *is* a tag and a payload; nothing narrower exists, since the whole content of the type is the absence of a guarantee. **344 occurrences across 36 sites** in `runtime/node` as a parameter alone. Record 0164 — `examples/in-on-a-native-receiver` and `examples/in-over-an-object-with-an-optional-declarer` |
| ✅ | `unknown` narrowed to **`{}`** by a `!== null`, which is declined rather than read through. `{}` is the checker saying *not null and not undefined* rather than naming a shape: it declares no member, so the narrowing buys nothing, and an unerase to it is a claim that the value is one of those — about a type no object belongs to. Unchecked on a lane with pointers; `ClassCastException` on the one that checks — `examples/erased-truthiness` for `unknown` in an operand position; **no example narrows one to `{}` by a `!== null`**, which is the specific shape this row claims |
| ✅ | `Symbol()`, with a description or without — every call a fresh identity, because `Symbol("a") === Symbol("a")` is false `examples/symbol-values` carries the symbol used as a value, which the row above distinguishes from a symbol used as a name. |
| ✅ | `Symbol.for` and `Symbol.keyFor` — one symbol per key for the life of the runtime. The registry's strong reference is the specification's rule rather than a leak, and is the whole difference from `Symbol()` — `examples/symbol-values`, seven uses of `Symbol.for` across one registry |
| ✅ | `typeof` answering `"symbol"`, `===` by address, a symbol in a field, and `Map`/`Set` keyed by one or by `string \| symbol` `examples/symbol-values` carries the symbol as a value, which is what these three questions are asked about. |
| ✅ | **`Date`** — a millisecond offset from the epoch and nothing else, which is what the specification's *time value* is. `new Date(ms)`, `getTime` and `valueOf`, and the `TimeClip` normalisation the constructor applies: truncated toward zero, NaN outside ±8.64e15, and `-0` normalised to `+0`. **55 refusal sites in `runtime/node`, all of them `fs.Stats.atime` and its three siblings** `examples/dates-unsupported` marks the boundary from the other side: it typechecks and every export in it must be refused. |
| ✗ | `Date.now()` and `new Date()` with no argument | they read a wall clock this runtime has no capability for — and **no differential could check them if it had one**, because node would answer with its instant and this with a later one. The same reason `Math.random` is absent |
| ✗ | `Date.toISOString` | it throws a `RangeError` on an invalid date, and a runtime helper here has no way to throw. Answering with a string instead is a divergence the differential **cannot see**: it scores node's throw as a case not reached rather than as a disagreement. Both call sites in `runtime/node` guard it with `Number.isNaN(d.getTime())`, and the guard is on the value, which the lowering cannot see. The calendar is not carried unreached — it was written, tested against node across leap years and both era boundaries, and removed |
| ✗ | the `getFullYear` family | they read a **local** calendar, which needs a timezone database this compiler does not carry and would make one program answer differently on two machines |
| ✅ | `ReadonlyMap` and `ReadonlySet` — the same runtime table in a narrower type. Readonly-ness is a *type-level* fact, the one this document already records as not changing storage, so representing them as the table they are is right rather than a convenience. Leaving them out stopped them at the frontend's library boundary and left every property holding one unrepresentable: `#uniqueHeaders` alone was **89 of `http`'s 154** local refusals — **no example declares a `ReadonlyMap` or a `ReadonlySet`**, so the narrower-type half of this row rests on the first clause of ✅ alone |
| ✗ | a **well-known** symbol as a value — `Symbol.iterator`, `Symbol.asyncIterator`. They are declared in `lib.d.ts` as `unique symbol` properties of `SymbolConstructor` rather than calls, so they need a static singleton per name rather than the two entry points above |
| ✅ | `sym.description` and `sym.toString()` as member reads | **landed 2026-09-13, and the row's own sentence was the whole specification of the work.** It said the two helpers "exist and are tested, and nothing lowers a member access to them yet", and that was exactly true: both are in `runtime/c`, in `hir::runtime`'s table and in LLVM's signatures already, so this added **no runtime surface** — nothing to regenerate, no backend to red-gate while it catches up, which is the rarest shape a feature takes here. Two arms: `symbol_property` for the read and `symbol_method` for the call, the latter named rather than left to fall through because the refusal below it says "a method call on something without methods" and a symbol has two the language defines. `description` is `string \| undefined` and the helper returns a possibly-null `NtsString *`, which is what this compiler already means by an absent string — null and undefined are one value here — so `d === undefined` is the null test it already lowers. `examples/a-symbols-description` is 174 cases across six functions on **C, LLVM and the JVM**, against 29 across one before. Its load-bearing arm is `sameAsConversion`: `String(sym)` lowered before this and `sym.toString()` did not, they reach one helper, and asking the two spellings for the same answer is what would catch a wrong wiring that a plausible-looking length never would |

And a symbol as a **member name** is still a field. That is the shipped
`symbol-keys` row above, and giving symbols a runtime representation must not
turn it into a map lookup: the uniqueness of a `unique symbol` is a *type-level*
fact the checker uses to tell one member name from another, and it says nothing
about the machine value. `compiler/core/tests/symbol_values.rs` guards it, and
that guard is checked by pointing it at a fixture that does make symbols.


### A class's identity is the layout's, and that is right until it is not

`instanceof` and `.constructor` are the two places JavaScript stays *nominal* at
runtime. `instanceof` works now; `.constructor` does not, and the reason is the
same one that made `instanceof` interesting to build.

Two classes of the same shape share one layout — deliberately, because
TypeScript is structurally typed and the two are mutually assignable, so sharing
the struct is what makes passing one where the other is expected cost nothing.
But they share the *descriptor* with it, and a descriptor is what an object
carries to say what it is:

```c
struct NtsObj_Alpha { ... };
void Beta__constructor(NtsObj_Alpha * v0, double v1);
static const NtsDescriptor nts_desc_NtsObj_Alpha = { ..., "Alpha", ... };
v3_frame.header.descriptor = &nts_desc_NtsObj_Alpha;   /* this is a Beta */
```

This was written when nothing could observe it. `instanceof` observes it: `v
instanceof Alpha` was true of a `Beta`, and an uncaught `TypeError` printed
`RangeError` — because all seven provided error classes hold a `message` and a
`name` and nothing else, so all four were one layout.

The error family is fixed, by refusing to merge two *differently named provided
error classes* and nothing else. Widening that to every declared class breaks
`function-values` and `readonly`, which is structural typing doing its job: two
interfaces of one shape have to share a struct.

So the limitation stands for user classes of identical shape, and it is stated
rather than hidden: `class Alpha { x: number }` and `class Beta { x: number }`
are one descriptor, and `instanceof` cannot tell them apart. The fix is the one
this section always described — identity is nominal and wants a table of its
own, one entry per class carrying the name and the base, with the descriptor
following the class rather than the layout. What is new is that there is now a
feature that would use it.

Worth knowing before starting: of the 67 refusal sites that named a class used
as a value, fifty-nine are one idiom in the node profile —

```ts
override get ["constructor"](): unknown { return TypeError; }
```

— and the remaining eight are `instanceof` against `Error`, `RangeError` or
`Uint8Array`. The first two of those three now work; a class used as a *value*
is what the rest still want, and it is a different feature from this one.

## 5. Modules

| | | |
|---|---|---|
| ✅ | `import { x }`, `import { x as y }`, `import type` — `examples/module-cycle-reexport` and `examples/generics` |
| ✅ | `import * as ns` and members through it `examples/module-namespace` carries it — the form that binds a name to a module rather than to anything in it. |
| ✅ | `export`, `export { x as y } from`, `export *` — `examples/module-cycle-reexport` for `export { core } from`, `examples/library` for `export *` |
| ✅ | evaluation order rooted at the entry module, matching node `examples/module-init` carries the statements at the top of a file, `examples/module-evaluation` the sequence of independent statements, and `examples/module-order` an import order chosen on purpose because it is what makes the question observable. |
| ✅ | cycles: self, three-way, crossed by a function, re-export, late read `examples/module-cycle-self` carries the smallest one — a module that imports itself, which is legal and is a cycle. |
| ✅ | the temporal dead zone as a **compile-time** error (NTS1004) — **no example and no blocker fixture mentions NTS1004**, so this refusal is asserted and not exercised |
| ✅ | module-scope state, including references `examples/globals` carries it, under the definition that makes it a row: state that outlives a call. |
| ✅ | `import def from` — default imports | `export default x` binds the name `default` in the module's namespace, so this is `import { default as d }` and needs nothing of its own. Marked ✗ until an audit of this table against the compiler tried it; the gap was a missing fixture, not a missing feature `examples/default-imports` carries it, as `import def from "./m.js"`. |
| ✗ | dynamic `import()` |
| ✅ | a module-scope `const` holding a function, called, passed and compared by identity `examples/module-functions` is exactly this, and `examples/function-in-an-object-literal` the same function held in an object literal and called through it. |
| ✗ | a module-scope `let` holding a function — a second arrow is a second layout |

## 6. The type system

Types are erased: they decide representation and then stop existing. Nearly all
of the surface therefore costs nothing.

| | | |
|---|---|---|
| ✅ | aliases, unions, intersections, literal types, tuples `examples/unions` carries the union as one value with a tag, and `examples/literals` the strongest thing TypeScript can say about a number. |
| ✅ | optional and `readonly` properties, index signatures | `readonly` was ✅ here while **leaking by name across the whole program**: one `readonly count` anywhere made every `count` in every unrelated type readonly, and twenty-four legal assignments in `runtime/node` were refused for it. Asked of the property's own declaration now, and of the *type* rather than the layout — a layout is shared by every type of the same shape, and `same_shape` ignores `readonly` on purpose. Record 0114 `examples/readonly-names` carries the fact the row turns on, that `readonly` belongs to a property rather than to a name, and `examples/string-keyed-table` the index signature as a table rather than a struct with no fields. |
| ✅ | mapped, conditional, indexed-access, `keyof`, `typeof`, template literal types — `examples/has-own-over-an-optional-property` for `keyof`. The other five of the six are uncited, and this row is six claims |
| ◐ | function and constructor types | **the function half is answered and the constructor half is not, probed 2026-09-14.** `type Op = (a: number, b: number) => number` with an arrow bound to it and called compiles clean. `type Maker = new (n: number) => Holder` type-checks and is representable, but constructing through a value of that type refuses: `NTS1001 a \`new\` through \`m\`, which holds a class rather than naming one -- the constructor would be chosen from the declared type and not from the value`. So the type form exists and the only operation it is for does not, which is ◐ rather than ✅. Related but not the same row: §4's *class used as a value* is answered, and the union of two class values is its own ✗. |
| ✅ | `interface`, including `extends` — `examples/interface-dispatch`, `interface Reporting extends …` |
| ✅ | `as`, `satisfies`, `as const`, `!` — `examples/a-structural-cast-that-is-a-prefix` for `satisfies`; `as const` is separately audited in §16 and worth nothing today |
| ✗ | `namespace` | **probed 2026-09-14 and the ✅ was false.** Eleven characters of claim and no evidence, which is the shape the `symbol` row already names as having been wrong three times in two days. All four forms refuse, and they refuse on two binaries rather than one: a namespace holding a `const`, one holding an exported `function`, a nested `namespace`, and two declarations merged under one name. `NTS1001 \`Shapes\`, a namespace`, from `describe_name` at `hir/lower.rs:7923`. Demand is not zero — this is the TypeScript-only module form, and §5 already carries the ES-module rows it does not overlap. What it needs is a lowering for a namespace as a *value*: today the name reaches `describe_name` at all, which means nothing has produced storage for it. **The ambient forms split, and the split is useful.** `declare namespace libc { type c_int = number }` compiles clean — a namespace holding only *types* is erased and never needs storage. `declare namespace libc { function abs(v: number): number }` refuses as soon as `libc.abs` is called. So the rule is not “ambient is fine”, it is **types yes, values no**, and it decides the shape of a generated `.d.ts`: one namespace per C header does not compile, flat `declare function` does. **Scoped 2026-09-14, and the consuming half is already built.** `A.x` where `A` is a module already lowers: `denotes_a_module` answers true and the member goes through `lower_identifier`, because the checker has resolved it to the export's own symbol (`hir/lower.rs:24293`). A namespace member would take that same path unchanged. What is missing is the *producing* half — nothing gives a namespace's members storage. `denotes_a_module` tests declaration **kinds** (`NAMESPACE_IMPORT`, `SOURCE_FILE`) rather than the module flag, deliberately, and a namespace is neither. **Corrected 2026-09-14: the kinds do exist** — I had searched for a constant named `MODULE_DECLARATION`, found none, and concluded the schema had nothing. `syntax.rs:660-661` carries `(268, "module declaration")` and `(269, "module block")` in the *spelling* table, with no named constants, which is why a name search missed them. And lowering already refuses the shape explicitly: `lower.rs:3172`, from the loop over a module root's children, produces `a module declaration, which has code in it`. Beware `is_module_declaration` at `lower.rs:953` — despite the name it means *a module-scope declaration module evaluation need not run* (function, class, interface, enum, EOF), so a namespace is excluded from it and falls through to the refusal. So the work is: name the two kinds, walk the module block, register each exported member as module-scope storage under a qualified name, and add the kind to `denotes_a_module`. Note the flag is **not** the way in even now that it is correct — see the warning on `module_namespace_of`. This crosses `semantic-schema` and `frontend-ts`, so it wants coordinating with whoever else is in the frontend. |
| ✅ | `declare` (ambient) | probed 2026-09-14, and the claim holds for the flat form: `declare function abs(v: number): number` called from an export compiles clean. Thin cell filled deliberately rather than left — what it does **not** cover is a `declare namespace` containing a value, which is the `namespace` row above and refuses. — `examples/classes`, the only example with a `declare function` |
| ✅ | `enum` — numeric members, explicit and implicit, negative and fractional | the checker has already done the arithmetic and gives the member access a *literal* type, so `Colour.Red` is an **immediate**. There is no object: `tsc` emits a table per enum and reads a property per use, and the emitted C here is byte-identical to writing the numbers. The old note said `Colour.Red` resolves `Colour`, which is a type and not a value — true, and not the obstacle: the enum is not used as a value, the member is `examples/enums` carries them, under the claim that decides their representation: an enum is a set of named constants and nothing at run time. |
| ✅ | `const enum` | the same substitution, which is what TypeScript's own erasure of one does. A plain `enum` differs only in also emitting the reverse-mapping object, which nothing compiled here reads `examples/enums` carries the enum forms together; a `const enum` differs from the others only in having no table left at run time, which is the same claim the plain row makes about all of them. |
| ✅ | a **string** enum member (`Label.Short`) | a constant too, and a *managed* one: it takes the interned static a string literal gets rather than an immediate. The checker gives the member access the same `Literal(String("s"))` type it gives the literal, so the two do not merely agree — they **share one static**, verified in the emitted C. Empty members, `const enum` members, and a member defined as another all fold the same way `examples/string-enum` carries it, on the point that makes it worth separating from the numeric case: a string member is a constant like a numeric one and a different thing to store. |
| ◐ | the **reverse mapping** at a constant index is answered as of 2026-09-13; at a computed one it is not | a numeric enum emits a table alongside its members mapping each value back to the member's name, so `Colour[1]` is `"Green"`, and at a constant index that is a string the compiler already holds — folding it is exact. **At a computed index it is not**: `Colour[n]` for an `n` no member has answers `undefined` in JavaScript while TypeScript, under this project's settings, types the whole expression `string` — so a lookup producing the declared type would be wrong precisely where the program is asking a question it cannot answer statically. Closing it needs the answer to carry absence, which is the `string \| undefined` representation the optional-property work settled for *fields* and nothing has settled for this. The same split as `Object.hasOwn` against `Object.keys` and `Array.from` over an iterable against over an array-like: **the form that names its key is answerable and the form that computes one is a different feature.** The numbering is TypeScript's rather than the position — a member with an initializer takes it and one without takes the previous plus one, so `enum E { A, B = 5, C }` is 0, 5, 6 — and the lowering carries a running total; `withAGap` is the arm that fails if the rule is read as "position". A **string** enum has no reverse map at all and that is the specification's rule, so the lowering tests each member's folded value rather than the enum's declaration. `examples/an-enums-reverse-mapping`, **145 cases across five exports** on C, LLVM and the JVM, with `examples/enum-reverse-map-unsupported` holding both refused forms. **Zero corpus demand, measured**: `runtime/node` declares **no enums at all**, 0 across every module against a control matching 2. A specification row closed with no axis movement |
| ✗ | decorators | **not refused — silently dropped, found 2026-09-13, and that is worse than a gap.** `class Thing { @doubled value() { return 5 } }` with a decorator that replaces the method emits `Thing__value` returning **5**, where the decorator makes it 10. Not applied, not refused, not mentioned. **The differential cannot see it by construction**: node has no native decorators, so the harness's form of the program fails to load and `nts check` reports a node crash rather than a disagreement — every other instrument is happy, because it compiles, emits, links, runs and returns a number. Two probes missed it before the third reached it: a **no-op** decorator compiles and answers the same whether applied or ignored, and one taking a `ClassMethodDecoratorContext` refuses as *a parameter of unrepresentable type*, which reads like "decorators are refused" and is an accident of the decorator's own signature. **Refusing it is a frontend change first**: `syntax.rs` has `(171, "decorator")` in its name table with no Rust constant, nothing in `compiler/core` mentions decorators, and `nts frontend` decodes none — so the compiler cannot see what it is dropping. Zero uses in `runtime/node`, `examples` and `benches`, which is not the reason to leave it: the cost of finding this again is the cost of finding it this time, and this time it took a probe written for something else. `blockers/a-decorator-is-silently-dropped` |

## 7. Values and representation

| | |
|---|---|
| ✅ | `number` (f64, narrowed to `i32`/`u8`… where proven) `examples/wide-operand-narrow-result` carries the rule the narrowing follows, that an operation is as wide as the widest value it touches, and `examples/field-widths` a field whose width depends on its own value. |
| ✅ | `boolean`, `string` `examples/strings` carries the string half, under the fact that decides its representation: a literal is immutable and known at compile time, so it is static data. |
| ✅ | arrays; a tuple whose elements agree *is* an array of them `examples/arrays` carries the indexing side, where `noUncheckedIndexedAccess` makes a read optional, and `examples/growable` an array that grows. |
| ✅ | heterogeneous tuples — a struct with positional fields, `_0` and `_1` `examples/tuples` carries them — a fixed-length heterogeneous sequence, which is what the positional struct is for. |
| ✅ | objects — a flat struct with a layout `examples/key-order-follows-the-program` carries what fixes the field order, and `examples/references` the objects that hold other objects, which is where a store has to do more than write. |
| ✅ | typed arrays: all eight kinds, as `NtsArray` with a narrow element **Enumeration checked 2026-09-14, and it is exact.** No single example carries eight, so this row cites the suite rather than a directory: across `examples/`, eight distinct spellings appear and they are precisely the eight this row claims — `Uint8` (79 uses), `Uint16` (14), `Float64` (9), `Int32` (6), `Uint32` (5), `Float32` (4), `Int16` (3), `Int8` (2). The three JavaScript typed arrays that do **not** appear are `Uint8ClampedArray`, `BigInt64Array` and `BigUint64Array`, and all three are accounted for elsewhere in this file rather than missing — the clamping one under `instanceof` against a natively-represented type, the other two in §16's table. So "all eight" is the right number and not a round one. `examples/typed-arrays` states the shape the row depends on — a typed array is a **view** onto an `ArrayBuffer` — and `examples/typed-array-aliasing` the consequence, two views naming the same bytes. |
| ✅ | `unknown`, `any` sites, unions, optional properties — one 16-byte tagged value `examples/optional-properties` carries `x?: T`, and `examples/optional-unassigned` the field a constructor never writes. `examples/unknown` is the value with a representation and no facts; `examples/unions` the tag; `examples/unknown-references` a reference inside one, and `examples/unknown-returns` what a caller does with one. |
| ✅ | `null` and `undefined`, as two values — see below for what a pointer can hold `examples/nullable` carries them, under the claim that a nullable type costs nothing. |
| ✅ | `typeof` — including `"function"` for a closure and `"object"` for `null` `examples/typeof` carries the plain case — `typeof x` where `x` has a single known primitive type — and `examples/unknown-truthiness` the tagged one. |
| ✅ | `Map`, `Set` — one insertion-ordered table, keys and values as tagged values — `examples/map-and-set`, twenty-one `new Map` and five `new Set`. It exercises the *operations* and never iterates one; that claim is `examples/iteration` |
| ✅ | the polymorphic `this` — the receiver's own pointer, which costs nothing `examples/fluent-this` carries it, as `ref(): this` — the return that makes a fluent interface work. |
| ◐ | `bigint` — exact, and **128 bits** rather than arbitrary precision; `String()` in decimal, `BigInt()` from a number or a boolean `examples/bigint` carries it, named for the claim this row makes: an exact 128-bit integer. |
| ✅ | `symbol` — **an empty cell, probed 2026-09-13 and already landed.** The type carries in every position asked of it: a local, a parameter, a return, a class field, an array element, and `typeof v === "symbol"` over an `unknown` — 174 cases across six functions, each arm comparing two distinct symbols so an implementation that made them one object would answer differently. Creation (`Symbol("a")`), identity, and — as of the same day — `description` and `toString()` as member reads. What is **not** here has its own rows and neither is about the type: a **well-known** symbol as a value (`Symbol.iterator`) refuses as `a global member with no definition here`, and a symbol as a **member name** is the `symbol-keys` row. This is the third row in two days whose explanation cell was empty and whose claim was wrong — the other two were `conversion side effects`, which hid a wrong answer that ran, and `iterator helpers`, which was empty because nothing reaches it |

### `null` is not `undefined`, and a pointer holds one of them

A reference has exactly one spare bit pattern, so `T | null` and `T | undefined`
each cost nothing — the null pointer *is* the tag, and the common case pays
nothing for the distinction.

`T | null | undefined` has two absences and a pointer has room for one. It was
given the pointer representation anyway, and the compiler answered

```ts
const v: string | null | undefined = …;
(v === null ? 1 : 0) + (v === undefined ? 10 : 0)   // 11, which JavaScript cannot produce
```

Two absences now select the erased representation, where each has a tag of its
own — `NTS_TAG_NULL` beside `NTS_TAG_UNDEFINED`. The two tags are adjacent to
`NTS_TAG_OBJECT` on purpose, because `typeof null` is `"object"`: it keeps
`typeof x === "object"` a single comparison rather than a pair.

Measured before and after across the node profile: 1,155 refusal sites either
way, three moving in each direction. The correctness cost nothing in reach.

And a pointer carries *one* absence, so comparing it strictly against the other
absent literal cannot be true however the pointer is set:

```ts
const v: string | null = …;
v === undefined      // false, always. It used to answer yes to the null.
v == undefined       // true for a null — the loose one asks about either
```

The representation cannot tell them apart; the **type** still can, and that is
what answers it.

#### A property typed *exactly* `null`, which is neither of those

`T | null` is a pointer and `T | null | undefined` is erased. A property typed
`null` on its own is a third thing — one value, carrying nothing — and it has
**no representation**: `representation_of` has had an arm for `undefined` for as
long as it has existed and has none for `null`. Each name has a second job and
only one forced an answer. `undefined` doubles as the return type of a function
that returns nothing, so returns demanded it; `null` doubles as nothing, so no
position did.

**It is a root and its count understates it.** `a property \`X\` of
unrepresentable type (null)` is 9 things across 9 modules, and behind it an arm
of a discriminated union carrying `value: null` has no layout, so reading the
*discriminant* refuses:

```text
a property typed exactly `null` has no representation
  -> that arm of the union has no layout
     -> `kind` on a union one of whose members has no layout
```

which is `util/src/deep-equal.ts`'s `loosePrimitiveProbe` — four arms, three of
which lower perfectly well.

**Two three-character repairs were tried on 2026-09-13, measured, and
reverted**, and what they cost is the useful part. `TypeKind::Null => Erased`
made every example agree on all three backends and dropped refusals by 15–19 in
each of four modules — and broke `sweep`, because after `b.f = null` the checker
*narrows* `b.f` to type `null`, and a blanket erased representation sends the
conversion down the tagged path while the storage is still a pointer. The
missing arm is not an oversight; it is the absence of a single right answer.

**The `undefined` twin landed the same day, and the price was a bug three files
away.** Reading a `Void` contextual type as erased fixes `value: undefined` and
`return undefined` from a `void` function — and on its own it turns **12 of 24
addons red** with `NotDominated` inside a generator resume.

It does not introduce that. The refusal was standing in front of a
generator-resume path, and removing it was the first thing ever to compile one.
The bug is in `hir::suspend`: a rejection handler is a block like any other and
can read any value live before the `await`, and `crossing` spilled what was
*passed* to the handler without spilling what its body *reads*. The comment
above that code had found the same failure once before and fixed the half its
own program exercised. `live_in` of the handler block is the whole set, and it
was available all along because `crossing` runs on the **unsplit** function.

Refusals after: util −16, net −18, assert −16, stream −17, and 21 distinct
things across 16 modules under `` `X` or `X` where what it stands in for is not
a reference `` — the sixth-largest cause in the census.

`examples/a-slot-typed-exactly-undefined` is 116 cases across four functions.
**No arm in it exercises the suspend repair**, which is measured rather than
assumed: two candidates were written and each passed against a build with the
repair reverted. The repair's witness is the corpus and `addons` is its guard.

`null` is still refused and is a different problem —
`blockers/a-property-typed-exactly-null` carries its measurement.

One absence is also enough to answer `typeof`. Which of `"string"` and
`"object"` a `string | null` gives depends on what the pointer holds — a runtime
question, and the null pointer is the thing that answers it, so it is a branch
between two constants and never a tag read. This was documented here as refused,
on the reasoning that "a pointer carries no tag": true, and beside the point,
because with one absence the *nullness* is the tag. `typeof callback ===
"function"` is how an optional callback is checked, twenty-five times in node's
own sources.

Which is the other half of a wrong answer worth recording. Folding `typeof` from
the representation shipped with the closure test asking only whether the type id
was a *synthetic* closure — so a value of declared signature type, which keeps
its TypeScript function type id, answered `"object"`. node says `"function"`.
It was live for one commit. The gate did not catch it because the sweep produced
every value as an expression, and an expression's representation is its most
concrete one: `const v: Fold = (x) => x` is the closure, while `f(v)`'s
parameter is the function type. Same TypeScript type, two representations, and
only one of them was ever asked. The sweep now runs every cell twice, once on a
local and once on a value that arrived as a parameter.

A gap this opened, and what closing it cost:

`v?.length` directly on a two-absence union was refused. The receiver is erased,
and the arm the test establishes is the arm that may read the payload back out —
which lowering did not do, so the member read got a tag where it wanted a
string. Narrowing by hand worked all along (`v !== null && v !== undefined`,
`typeof v === "string"`, plain truthiness), which is what made it look like a
representation problem rather than a missing unerase on one path.

It was two refusals with different sentences and one cause: "`length` of
something without one" for a string receiver, and "a union whose members lay
their fields out differently" for an object one — said of a union containing
exactly one object.

The licence for the read-back is *not* the checker's. It narrows `v` inside an
`if`; it narrows nothing inside `v?.length`, where the only type it records is
`number | undefined` for the whole expression. It is this lowering's own: the
branch tests the tag against exactly the tags the receiver's type admits as
absences, so in the other arm what is left is the union's non-absent members,
and where those share a representation that is what the payload holds.

Measured across the node profile: **5,884 → 5,875 refusal sites**. 28 closed —
`err.stack` (15), `res.setHeader` (5), `stream.isTTY` (4),
`immediate._onImmediate` (4) — and 19 uncovered one step behind them, where the
value that now arrives meets a second wall: `String()` of an erased type (15)
and a method with no declaration in the hierarchy (4). Most of a closed refusal
is a moved one, and the count says so.

Closing it also surfaced a lifetime bug that had nothing to do with `?.` and
everything to do with two absences. Returning a *class* through
`T | null | undefined` handed the caller a pointer into a dead stack frame with
the object's fields already freed, because an erasure did not count as an escape
on a return. No example returned an object through two absences until the case
written for the refusal above did. Record 0032.

### An absent literal in an argument

`callback(null, value)` is how every node-style callback reports success, and
every one of them was refused: `null` has no representation of its own, so it
takes one from where it sits, and the argument position found nothing.

The cause was not the argument rule but the tree. `children()` flattens a
`List` node — an argument list, a parameter list — so a call's children are its
callee and its arguments, laid out flat. The `parent` link does **not**: an
argument's parent is the list, whose kind is no syntax at all. So the rule that
reads `f(null)` was looking at a node that matched none of its arms, and had
been since it was written; the comment above it claimed the case and no test
asked. `syntactic_parent` now steps over lists, which is the half of `children`
that was missing.

Under it sat a second one: a call through a *value* — `(callback as
Callback<string>)(null, resolved)` — resolves to no declaration, so there is no
call target to read a signature from. The callee's own type is a signature, and
that is the same answer reached from the other end.

### The frame's reference moves through the suspension

An async function's frame outlives the call that made it: it is handed to the
runtime at every `await` and read back when the promise settles. So the resume
**consumes** a reference — it either finishes and gives it back, or suspends and
leaves it with the runtime — and every caller provides one.

Without that the starter released the frame on its way out while a pending
reaction still pointed at it, and the resumption ran on freed memory. `hir::rc`
does not cover it: the frame is a *parameter* of the resume, and a parameter is
borrowed by that pass's convention. It is borrowed from whoever provided the
reference, which is what makes giving it back at the finishing exits — and at
none of the pausing ones — correct rather than double.

### A frame object's contents are its own to give back

A frame object cannot be *moved*. Reference counting hands ownership to a slot
when a value is stored and dies — the slot takes the reference the local was
holding, and releasing the container releases it. A frame object has no
reference to hand over: its storage ends with the frame whatever points at it,
which escape analysis is what guarantees. So a store neither takes a count nor
takes over the duty of giving the object's **fields** back.

Treating it as moved dropped that duty:

```ts
let text = "a";                                // a *managed* value
const grow = () => { text = text + "b"; };     // captured and written
```

The cell is frame-allocated — escape analysis proved it does not escape — so it
carries `NTS_IMMORTAL`, and the closure's own frame-release loads the field and
calls `nts_release` on it, which returns immediately for an immortal object.
Nothing then releases the *cell's* string. The same cell holding a number is
fine, because a number is not a reference.

The container's own release loads the field and releases the *pointer*, which
returns immediately for an immortal object, and the string the cell held was
never given up. A number in the same cell was fine, because a number is not a
reference.

Not a cost of reference counting: before escape analysis learned to put a cell
in the frame, the cell was on the heap and released normally. It was the two
changes meeting, and neither was wrong alone.

### What a program still holds at exit

`tooling/gate/rc.sh` runs every example under reference counting and records
what is live after the first case and again at the end, forcing a collection at
both. Growth between the two is a leak — agreement cannot see one, because a
function that never gives an object back answers exactly as well as one that
does.

Two examples grow and neither is a leak, which took separating rather than
assuming: `module-state` holds module-scope references, which is its subject,
and different cases set different globals; `timers` leaves one pending
60-second timer per case on purpose, and a pending timer holds its callback —
its sibling that calls `clearTimeout` shows no growth at all. Both stay listed,
because the check cannot tell state a program still needs from state it has
lost, and a *change* in either number is worth stopping for.

### There are two backends now, and they agree

`compiler/codegen/llvm` renders the same HIR as textual LLVM IR, fed to
`clang -x ir`. Textual rather than a linked `llvm-sys`, for the reason the C
backend has earned: reading `program.c` diagnosed three separate bugs in one
week, and an IR nobody can read gives that up. It also avoids pinning an LLVM
version into the build.

The C backend does not go away. It is the **oracle**: one HIR, two renderers,
and a disagreement between them is a backend bug *by construction* — the
program, the lowering, every optimisation and the runtime are identical, and
only the rendering differs. Nothing else here can isolate a backend that way;
the differential compares against node, which is the right oracle for semantics
and says nothing about which renderer was wrong.

That this is possible at all is a consequence of where suspension lives.
`hir::suspend` turns a suspending function into a state machine in the *middle
end*, before any backend sees it, so the C backend can express `async`. scriptc
put suspension in the backend, so theirs cannot — their C output is debug-only
and their LLVM output has no second opinion.

What is rendered so far is the scalar slice: numbers, integers and booleans,
arithmetic, comparison, conversions, direct calls, and control flow. Anything
managed is refused by name. The one structural difference between the IRs is
block parameters: HIR puts arguments on edges the way MLIR and SIL do, LLVM puts
the join in the successor as a `phi`. They carry the same information and the
translation is mechanical, which is a large part of why the lowering chose block
parameters in the first place.

Two things the move has already taught:

- **A `static inline` in a C header is not a contract another backend can
  read.** `nts_to_int32` is thirty-one such helpers' worth of the runtime, right
  for C — every translation unit gets ten instructions instead of a call — and
  invisible to a code generator that is not a C compiler. The inline stays and a
  linkable form stands beside it. What the runtime *offers* has to be linkable.
- **`#` is in every name this compiler invents** — `fib#whole`, `Closure3#call`,
  `module#init` — chosen because TypeScript cannot produce one. LLVM identifiers
  cannot hold it unquoted, so the quoted form is where that is absorbed.

Objects are rendered too, and that is where the layout engine stops being
merely checked and starts being load-bearing. The C backend writes `p->x` and
lets clang place it; the IR has no `p->x`, only `getelementptr i8, ptr %p, i64
24`, and the 24 came from `place()`. If the two disagreed about an offset they
would read different bytes of the same object.

The test drives both backends over the differential's own hostile pool — both
zeroes, both infinities, a NaN, past 2^53, the 1e21 boundary — with the runtime
linked into both, which is also the only place the C-to-LLVM ABI is exercised.

Two things that test taught, and both are about not assuming:

- **A field's representation is specialized.** The driver first wrote the struct
  out by hand and got it wrong: `y: number` is an `int32_t` in the emitted
  layout, because specialization narrows a field like any other value. The
  driver names no field now — every one is written and read through the program.
- **The ABI is taken from clang, not derived.** `clang -S -emit-llvm` on the
  same declarations prints `zeroext i1` for a `_Bool`, `signext i8` for an
  `int8_t`, and nothing for anything word-sized. A bare `i1` happens to work on
  x86-64 because both ends use the low bit of a register; "happens to work" is
  not an ABI, and the runtime this has to agree with is compiled by clang. The
  extension attributes are copied from what clang prints.

`NtsValue` by value was the part of the ABI that was not settled — a sixteen-byte
struct in seventeen runtime signatures — and it is settled now, by asking rather
than reasoning. `clang -S -emit-llvm` on a function taking one prints:

```llvm
define dso_local { i32, i64 } @passthrough(i32 %0, i64 %1)
```

Two separate scalar arguments in, a two-field struct out. The System V rule
classifies the sixteen bytes as two eightbytes, and the *second* is `i64` rather
than `double` because the union holds a pointer — which is exactly the detail a
careful reading would have got wrong, and the reason this was refused rather
than guessed at. An erased value is still refused in the backend until it is
built to that shape, but the shape is no longer unknown.

Descriptors, arrays, module-scope globals and reference counting followed, and
**67.8% of the 915 functions across `examples/` now render**, from 36.2% when
calls into the runtime first worked. A descriptor is the one piece of the
runtime a backend has to *build* rather than call — it is data the collector
reads — and it is emitted as LLVM's own struct type with the runtime's field
types in the runtime's order, so the two agree by construction rather than by a
hand-computed offset. What goes *in* one was already shared: `cyclic_layouts`
and `reference_fields` are the middle end's, the offsets are the layout
engine's, and only the rendering belongs to a backend.

Three more things the second backend has forced into the open, each of which was
a single-backend assumption:

- **The symbol name is part of the ABI.** `module#init` became `module__init` in
  the C output and `@"module#init"` in the LLVM output, so a driver could link
  against exactly one of them. The mangling — reserved words, header collisions,
  punctuation no C identifier may carry — moved to
  `nts_codegen_common::symbols` and both backends read it. It is still *C's*
  rule, and that is right: the linkage name has to be one every toolchain on the
  way to an executable can carry, and C's is the narrowest.
- **A `static inline` is not a contract.** `nts_check` and `nts_index` joined
  `nts_to_int32` in having a linkable form beside the inline. Reproducing a
  bounds rule in a second place is a second implementation to keep in step.
- **A field's representation is specialized**, so nothing outside the program
  may assume `number` means `double`.

### The definition of a valid program was a description of one backend

`verify::compatible` called any scalar compatible with any other, and the
comment above it said why:

> Two scalars are a conversion the backend already emits: a field narrowed to
> `i32` by specialization is assigned from a `double` and C converts.

That is a true statement about C written into the definition of a valid
program. It means the IR was *within its rights* to store a `double` into an
`i32` field, send an `i32` along an edge into an `f64` parameter, or hand a
`double` and an `i64` to one `+` -- and the only backend that ever had to notice
was the one that could not convert silently.

Making the rule exact and counting what fell out:

| | examples (89) | corpus (184) |
|---|---:|---:|
| before | 18 fail | 5 fail |
| after `reconcile_stores` and `reconcile_edges` | **0** | **0** |

Two kinds, and both are the same story. **`StoreType`** -- a field, an array
element, a global -- is specialization narrowing a *slot* and the *value* that
fills it independently, with nothing putting them back together. **`EdgeType`**
is a block parameter taking an `i32` where it declares `f64`; `specialize`
already unions a parameter with every argument feeding it, so only three
survived that union, and the conversion has to land in the **predecessor**,
because that is the only place both the value and the branch exist.

### Three things nothing was checking at all

Tightening the rule exposed which questions had never been asked. Each was added
as a check and then measured, because a check that has never fired is a claim
rather than a fact:

| new check | fired |
|---|---:|
| a binary's two operands agree with each other | 0 |
| a binary's result agrees with its operands | 0 |
| an array *read* agrees with the element type | 0 |
| **a direct call's result is what the callee returns** | **6** |

The zeros are worth as much as the six. The LLVM backend carried a copy of C's
usual arithmetic conversions to pick a type for a mixed-type `+`; the IR turns
out never to produce one once the stores are reconciled, so the mismatched `fadd
double %v25, %v33` that started it was the *store* bug propagating, not a
separate defect. That code is gone rather than kept "just in case".

The six are the 14x closure. Nothing said a call's result must be what the
callee returns, so specialization narrowed the result at the call site and left
the callee alone. It is explicit now: the call yields the callee's type and a
`Convert` narrows it.

### What the backends stopped deciding

Deleted from `compiler/codegen/llvm`, because the IR now guarantees it:
`usual_conversion` and `at_joint`, the edge conversions in `edge_value` and
`outgoing_conversions` (the whole of the second), the element conversions in
`element_access`, and the direct-call argument and result fixups. The C backend
had no code to delete -- its compensation *was* C, an implicit conversion at
every assignment, and it simply stops happening.

**What stays, and it is not compensation.** `helper_operand` and the conversions
around calls to the runtime are the boundary between our types and C's declared
ones: `nts_array_new(ptr, double)` wants a `double` length whatever
specialization narrowed ours to, and no amount of tightening the IR changes what
that function's signature says. The earlier plan listed those for deletion and
that was wrong -- an ABI boundary is not a backend making a decision it should
not.

The LLVM gate row went **56 to 60** on the tightening alone, before any deletion:
four examples the second backend had been getting wrong were programs the IR had
never been explicit enough to state.

### What a sharing slice would be worth, and why not yet

`substrings` is the worst row against hand-written C++, and the reason is in the
case's own comment: `std::string_view::substr` returns another view of the same
characters and allocates nothing, while every string this compiler makes owns
its bytes.

Before designing that, measure the ceiling. The same reference, once with
`string_view` and once with `std::string`, on one driver:

| word length | view | copy | penalty |
|---:|---:|---:|---:|
| 6 (this case) | 2.47us | 3.86us | **1.56x** |
| 20 | 9.63us | 12.39us | 1.29x |
| 60 | 18.25us | 21.72us | 1.19x |

Two things fall out. The copy is worth about **1.56x** on the shape this
benchmark has, so a perfect sharing slice would take the row from 2.10x C++ to
roughly **1.35x** -- most of the gap, not all of it. And the penalty *shrinks*
as words grow, because the scan that finds the boundaries is O(text) and it,
not the copying, is what a long-word parser spends its time on. Note also that
`std::string` at length 6 is inside its small-string buffer, so the C++ "copy"
column is a copy *without* an allocation -- which is what frame placement
already buys us.

**Decided: not now.** A slice that shares storage is a change to the string
representation itself -- a data pointer and an owner reference where there is
now inline data -- and it reaches `NTS_ELEMENTS`, every helper that walks
characters, reference counting (a slice keeps its owner alive), and
`nts_str_place`, whose whole trick is that the caller already has the storage.
1.35x is worth having and it is not worth having before the second backend can
render a closure or a suspension. The measurement is here so the decision can be
retaken rather than re-argued.

### Why the awfy family is slow, and it is two things

Five of the rows above 1.20x are one family -- small classes, and the C++ port
declares their coordinates `int32_t` where we declare `double`. `Ball` is 56
bytes of doubles against four `int32_t`. `fields::representations` exists to
prevent exactly this and its own comment names the case, so the question is why
it does not fire.

Isolating says it is two independent causes:

| | |
|---|---|
| `Plain` alone -- one field, assigned `7` in the constructor | **`int32_t`** |
| `Plain` beside an unrelated `SelfRef` with the same field shape | `double` |
| `SelfRef` alone -- `this.v = this.v + d`, then clamped | `double` |

**Structural aliasing is too coarse.** `shares_storage` matches on a field's
*name and type* along the prefix, so two classes that share no relationship at
all are treated as aliasing storage, and one class with an unbounded field drags
every similarly-shaped class down with it. The rule is justified as "exactly
when a pointer to one is a pointer to the other", which is true of base-first
*inheritance* -- but it never asks whether the two are related, only whether
they look alike.

**A self-referential field never tightens.** `this.v = this.v + d` reads the
field, so on the first round the store is computed from `Facts::TOP` and is
therefore TOP -- and TOP is a fixed point. `nts facts` shows it plainly:
`field.get %0.0` is `[-inf, +inf] nan?` in `Ball#bounce` while
`Ball#constructor` is 16/16 provably `i32`. `Random.seed` escapes only because
its update ends in `& 65535`, which bounds the store whatever the input was --
which is why field narrowing looked like it worked.

The clamp `if (this.x > 500) this.x = 500` does bound it, and believing that
means knowing what the field holds at function *exit* rather than joining every
store regardless of order. That is a flow-sensitive field analysis, not a
narrowing iteration, which is what I first prescribed.

**Only one of the two is worth spending on.** Checked across all 26 benchmark
cases: **no two layouts share a prefix** by accident, so the coarse aliasing
costs nothing measurable here. It is still wrong, and it will bite the first
program that has two unrelated classes beginning with the same field -- which
is not a rare shape -- but the awfy cluster is entirely the second cause.

And widening to a threshold is not the shortcut it looks like. Jumping to the
`int32` bounds instead of infinity would make `width_for` accept the field, but
widening is only sound when what it jumps to contains the true range, and
nothing here proves that. Thresholds need a descending pass afterwards to
confirm the result is a post-fixpoint; without it the answer is a guess that
happens to typecheck.

### `!invariant.load` is not what `readonly` means

`Field::readonly` is "never written after construction, semantic not syntactic,
so `Readonly<T>` counts", and its own comment lists *hoistable loads* among what
it is for. So `!invariant.load` on those loads looks obvious.

It is unsound. Given a load, a call that writes through the same pointer, and a
second load, LLVM folds the second into the first:

```llvm
  %a = load double, ptr %p, !invariant.load !0
  call void @construct(ptr %p)
  %s = fsub double %a, %a          ; the second load is gone
```

The metadata licenses "the same value at **all** points where the location is
dereferenceable", and for us that includes the zero an allocation leaves before
the constructor runs. `hir::fields` says as much about itself: *"Zero is joined
in as well, because that is what an allocation leaves. A well-typed TypeScript
program cannot read a field before its constructor writes it, but proving that
here would mean a definite-assignment analysis."* We assume it; we do not prove
it, and this metadata would be relying on the proof.

The tool for "written once at construction, invariant after" is
`!invariant.group`, which is what clang uses for vtable pointers and which is
scoped to handle exactly the construction window.

And there is nothing to measure it on: **no benchmark case uses a `readonly`
field**, by keyword or otherwise. An optimization with no case that exercises it
is a claim, so the case comes first.

### A closure was 14x slower, and the reason verified cleanly

With both backends in one bench run, `closures` came out at **16.33us through
LLVM against the C backend's 1.13us** -- same HIR, same machine, same run, same
checksum. Fourteen times, on a one-line arrow function.

The module says it plainly once you look:

```llvm
define internal double @Closure0__call(ptr %v0, double %v1) nounwind {
  ...
  ret double %v20
}
...
  %v17 = call i32 @Closure0__call(ptr %v5, double %v34)
```

Defined `double`, called `i32`. The definition took its types from the callee's
`Func` and the call site took them from the *operation*, and nothing reconciled
the two -- the signature table answers exactly this question for the runtime,
and nothing answered it for our own functions.

It is the ABI mismatch it looks like: the callee returns in `xmm0` and the
caller reads `eax`. And LLVM verified it without complaint, because with opaque
pointers a call carries its own signature and is entitled to disagree.

The cost is not only correctness. **LLVM cannot inline a call whose signature
disagrees with its callee**, so a closure that should have vanished stayed a
real call in the innermost loop, twice over. Taking a direct call's types from
the callee -- the same thing the table already does for the runtime -- put it at
**1.13us, level with the C backend and 1.01x hand-written C++.**

A scan of every emitted module for the same shape now reports zero. It is worth
keeping in mind that it was *silent*: it verified, it linked, and it agreed with
node. The only instrument that saw it was a second backend measured beside the
first on the same program.

### The bench measured one backend, and the other one was full of holes

`tooling/bench` compiled through the C backend and only the C backend, which
was right while there was one of them. Running the same 25 cases through the
second, at `-O2 -flto`, **five ran and twenty did not** -- against a gate that
said green with 49 of 88 examples carried.

The gate was not lying. It was answering a different question. An example that
fails to *build* and an example the backend has not learned both count as "not
carried", so 39 refusals hid a dozen broken modules among them. A number that
cannot tell "I decline" from "I emitted nonsense" will report the second as the
first for as long as you let it.

Every one of the bugs is the same shape, and it is the shape this whole
exercise keeps finding: **C converts silently and a module has to say it out
loud.**

| what clang said | what was wrong |
|---|---|
| answered `1.3186118021857029e-314`, node said `2668900000` | `ArraySet` took its element type from the **stored value**, not the array |
| `fadd double %v25, %v33` with `%v33` an `i64` | binary operands never met at one type |
| `use of undefined value '@Benchmark__innerBenchmarkLoop'` | a *refused* function was still called |
| `use of undefined value '@nts_to_uint8'` | a `static inline` has no symbol and no table entry |
| `'%v22' defined with type 'i32' but expected 'i64'` | `ToInt32` hardcoded an `i32` result |
| `nts_unit_fn(ptr, i32 %v46)` with `%v46` a double | `StringUnitAt` hardcoded `double` both ways |
| `zext i32 %v2 to i32` | `int32_t` to `uint32_t` is a conversion in C and nothing in LLVM |
| `nts_array_new(ptr, double %v1)` with `%v1` an `i32` | the signature table had exactly one reader |

Eighteen of the twenty are now clean refusals and the other two run. Two of them
deserve their own paragraphs.

### An `i64` and a `double` are the same eight bytes, and only one is right

`erasure-stored-typed` answered `1.3186118021857029e-314` where node answered
`2668900000`. That is not a rounding difference; it is `2668900000`'s bit
pattern read as a double.

`ArraySet` chose the type of the *value being stored* rather than the type the
array holds. Specialization had narrowed the value to an `int64_t` while the
array's descriptor still said eight-byte doubles -- so the store was `store
i64` into memory every reader loaded as a `double`. **The widths matched**, so
nothing crashed, nothing was diagnosed, and the answer was wrong.

The C backend cannot make this mistake, and not because it is more careful:
it writes `elements[i] = value` through a `double *`, so C converts on the way
in. The element type now comes from the array, and the conversion is written
down.

### A refusal has to look like a refusal

Seven benchmarks failed with `use of undefined value
'@Benchmark__innerBenchmarkLoop'`. The callee needed a method table and was
refused; the *caller* rendered fine and called it anyway. A module that
references a name nothing defines is not a module -- clang rejects the whole
file, so one refused function took out everything.

A refused function gets a `declare` now. The module verifies, the link fails,
and the error names the function that was not built -- which is exactly where
the C backend has always put it, because C emits a prototype for everything and
lets `ld` say what is missing.

The `_fn` distinction came back too. `nts_to_uint8` is `static inline` in the
header: no symbol to link against, and no row in the generated table because
the table is built from what clang *declares*. Emitting the call anyway made a
broken build out of what should have been a refusal. A call to a helper the
table does not carry is refused now, for the same reason `nts_to_int32_fn`
exists at all -- **a `static inline` is not a contract another code generator
can read.**

### A generated file with no generator, and a check that did not check

`src/signatures.rs` said it was generated and nothing generated it: it was
produced once, by hand, out of band. `NTS_REGENERATE=1 cargo test -p
nts-codegen-llvm --test signatures` writes it now, from the same parse that
checks it, so the two cannot answer different questions.

The check had a hole of its own. It compared return types and parameter types
and *not* attributes -- the part worth 5x. An attribute that stopped being
emitted would have cost that with every test still green. It compares them now.

And it skipped too politely. Failing to compile the probe returned "no
toolchain", which is what a missing clang looks like; a broken header looked
exactly like a machine without a compiler. Clang absent still skips. Clang
present and refusing now fails, with what it said.

### `nts emit-llvm` printed nothing about what it had refused

`emit-c` reports the lowering's diagnostics and `emit-llvm` reported only the
backend's, so a module with two refusals in it -- a top-level loop assigning a
module-scope name, and a `console.log` -- printed an empty `module__init` and no
explanation. It looked like a backend that had rendered everything asked of it.
It reports both now.

The same shape as `uncompilable C` being 15 and invisible: the number was not
wrong, nothing printed it.

### The second backend runs the whole differential

`NTS_BACKEND=llvm` drives every example, every case and the same hostile pool
through `compiler/codegen/llvm` and compares against **node**. That is a
stronger net than comparing the two backends to each other on a handful of
fixtures — node is the oracle either way, and two backends that both agree with
node agree with each other.

An example is either wholly rendered or not attempted, because a function the
backend has not learned is absent and the driver would fail to link. So the
number is *examples carried*: **49 of 88**, and the gate ratchets it upward. The
direction matters. The C backend's match is exhaustive, so adding an `OpKind`
breaks its build; this one has a fallthrough that refuses, which is safe and is
exactly how a second backend silently falls behind.

### An attribute is a promise, and it is worth 5×

The C backend gets facts for free that an LLVM module has no way to know.
`NTS_READS_ONLY` is `__attribute__((pure))` on twenty-nine runtime
declarations, and the header explains why it is not decoration:
`text.indexOf("brown")` inside a loop is loop-invariant, and a compiler may hoist
it only if it knows the call has no side effects. Generated C carries that fact
because it includes the header. A module includes nothing.

Measured on exactly that program, three million iterations:

| | time |
|---|---|
| with `nounwind willreturn memory(read)` | **2.29 ms** |
| without | 12.31 ms |

Same checksum. The attributes come from clang rather than a manual — `pure` maps
to `nounwind willreturn memory(read)`, and that mapping is clang's business —
and they are carried in the same generated table as the signatures.

One of them had to be taken *away*. `nts_check_fn` was declared
`NTS_READS_ONLY`, which clang turns into `willreturn` — and a bounds check that
fails does not return, it aborts. That would have licensed hoisting a trap out
of the branch guarding it. An attribute is a promise, and a promise that is
nearly true is worse than none.

### An attribute the header states once, and both backends get

`nts_object_new` and its five siblings always return a *fresh* object: never
null, reachable through no pointer the caller already holds. Written in the
header as `__attribute__((malloc, returns_nonnull))`, that reaches generated C
because C includes the header and reaches the module because the signature table
is generated from what clang says. One place, both backends.

**Measured, and it bought nothing.** On an allocating loop -- four million fresh
two-field objects, each written and read -- 0.23s with the promise and 0.23s
without, same checksum. Adding the stronger claim by hand (`memory(argmem: read,
inaccessiblemem: readwrite)`, which is how LLVM models `malloc`) also changed
nothing. The reason is the honest one: the allocation call *is* the cost, and no
promise about what it does short of deleting it changes that.

It stays because it is true and free, and because `noalias` pays in shapes that
have not been written yet. But it is recorded as a measurement rather than a
win, because "the attributes are worth 5x" was a real number from a real
program, and this is not that.

Applied only where the definition allocates unconditionally -- and the
exclusion that matters is the `_into` family, which returns storage its *caller*
supplied. That is a pointer the caller already holds, which is exactly what
`malloc` promises cannot happen.

The first version of that reasoning was invented rather than read. It said
`nts_str_slice` may hand back its argument and `nts_tag_name` returns one of
seven static strings; neither is true -- `nts_str_slice` routes through
`nts_str_raw` and allocates every time, and `nts_tag_name` builds a fresh string
on every call. The functions excluded were still the right ones, by luck rather
than by the reason given, which is worth writing down: a promise that is nearly
true is worse than none, and so is a reason for one that was never checked.

### `nsw`, exactly where clang puts it

`int32_t` overflow is undefined in C, and `Int { bits: 32, signed: true }` is
`int32_t`. So the C backend has always been compiled under the stronger
assumption -- clang writes `add nsw i32` for it -- while the LLVM backend wrote
a bare `add`. That is a divergence in the direction nobody wants: the *primary*
backend giving up an optimization the reference implementation already takes.

Which operations carry it is read off clang rather than off C11 6.5, for the
same reason the signatures are:

| | |
|---|---|
| signed `+` `-` `*`, unary `-` | `nsw` |
| unsigned `+` `*` | nothing |
| `<<`, `/`, `>>` | nothing, even signed |

There is no `nuw` anywhere and its absence is the point. Unsigned overflow in C
is *defined* to wrap, so `nuw` would be the one place this backend promised more
than its oracle does.

### A read-only array loop is at parity, and the counter is not the reason

A `for (let i = 0; i < xs.length; i++)` counter stays a `double`, because
`xs.length` is a `uint32_t` and does not fit an `int32_t` -- so the loop pays a
`fptoui` per element and carries `fadd double %i, 1.0` instead of an integer
induction variable. That looks like it should cost something.

Against the same loop written by hand in C++ over a `std::vector<double>`, four
thousand elements, twenty thousand rounds:

| | time |
|---|---|
| nts, through LLVM | 0.05s |
| hand-written C++ | 0.06s |

Same checksum. The accumulator is a chain of dependent `fadd`s, four cycles
each, and neither compiler can vectorize a floating-point reduction without
being told it may reassociate. The counter's type is not the wall; the
arithmetic is, for both. A narrower counter is still worth having for the loops
that are not reductions -- but it is not the thing standing between this and C++
here, and it would have been easy to spend a day believing it was.

### What may alias what, and a measurement that was too short to show it

Add a *store* to that loop -- `xs[i] = xs[i] * k` -- and it changes character.
The element block pointer and the length both live in the array's header,
reached through the same parameter, so a `store double` may for all LLVM knows
have overwritten them: they are re-loaded on every element.

The generated C does not have this problem. C's rule is that two accesses of
different types do not alias, so clang hoists the `uint32_t` length and the
element pointer out of a loop that only writes `double`s. **A module carries no
types at all once it is written.** `store double` and `load i32` are both just
bytes.

The first measurement said there was nothing here:

| | 20k rounds |
|---|---|
| LLVM backend | 0.04s |
| C backend | 0.04s |
| hand-written C++ | 0.03s |

Three numbers at 10ms resolution, which is not a measurement of anything -- 0.04
and 0.04 could be 0.035 and 0.044. Twenty times the work:

| | 400k rounds |
|---|---|
| LLVM backend, before | 0.85s |
| LLVM backend, with `!tbaa` | **0.78s** |
| C backend | 0.78s |
| hand-written C++ | 0.58s |

So the gap was 9%, it was **to our own oracle rather than to clang**, and a type
tree closes it exactly. The lesson is the older one: a number whose resolution
is the same size as the effect is not evidence, and "they came out equal" is the
easiest wrong answer to accept.

The remaining 0.78 against C++'s 0.58 is shared by both backends and is a
different question -- C++'s `vector` is a local whose address never leaves the
function, so its size and data pointer cannot be disturbed by anything at all,
where our array arrives as a parameter.

Only types, not fields: LLVM's struct-path TBAA would additionally say `Point.x`
and `Point.y` do not alias, which is where soundness stops being obvious, and
the plain type rule already recovered the whole difference. `i8` deliberately
has no node -- it is the omnipotent char and aliases everything, which is what C
says and what string data is.

**The tree is clang's, and the first one was not.** It invented a root,
`!{!"nts"}`, and the worry about that turned out to be backwards. The fear was
unsoundness under `-flto` -- which `tooling/bench` uses -- from two trees
describing the same memory. The experiment says otherwise: a loop that loads a
`double` and stores an `int` through an unrelated pointer has its load hoisted
clean out when both tags sit under clang's root, and moves *nothing* when the
store's tag has a root of its own. Unrelated roots are treated as possibly
aliasing.

So an invented root is safe and **useless across a translation unit**: every tag
the runtime carries would be opaque to every tag we emit, and under LTO -- where
the runtime is finally visible and there is most to gain -- it would have gained
nothing. Metadata nodes are uniqued by content, so spelling the tree exactly as
clang spells it makes our `double` node *be* the runtime's. The names are not
guessable and were read off clang: `int8_t` and `uint8_t` are character types
and get the omnipotent char, signed and unsigned share a node so `uint32_t` is
`"int"`, `int64_t` and `uintptr_t` are both `"long"`, and `_Bool` keeps its
underscore.

`NtsValue` gets the char node rather than one of its own, because it is a union
in C and this is not the place to make a claim about one. Measured on an erased
field read inside a storing loop, giving it a distinct node was worth nothing,
so the conservative choice is free.

What makes it sound is that every field is accessed at exactly one LLVM type:
the type comes from `field_at`, off the field's HIR type. An erased value is
read and written whole, as `{ i32, i64 }`, never as a `double` through one path
and an `i64` through another -- the one place a union could have made this a
lie.

### Two things C was doing silently

Both found by assembling what the second backend emitted, and both are facts
about the *middle end* rather than about either backend.

**The IR is under-specified about edges.** `verify::compatible` treats any
scalar as compatible with any other, so specialization may send an `i32` along
an edge into an `f64` block parameter. The C backend writes `v7 = v0;` and lets C
convert; a `phi double` taking an `i32` is not a module. The conversion is
written out now, in the predecessor, because that is where a phi's incoming
value has to be available.

**And about call results.** `nts_str_index_of` returns a `double` into an
`int64_t` slot, and C converts without a word.

Neither was wrong in the C output. Both were places where the IR relied on a
property of C rather than stating what it meant, and only a second backend could
have found them.

### `this` is a free variable of an arrow, and was the only one not treated as one

Two rows in §15 looked like the case for structural dispatch: "a member `X`
which `Y` does not declare" at 72 sites, and "a method `X` with no declaration in
the hierarchy" at 64. Counting what was behind them says otherwise. They are one
bug, and it is not about interfaces.

An arrow does not bind `this`; it inherits the enclosing method's. Inside a
lowered closure `this` was the *closure object* — parameter zero of its `call` —
so a body saying `this.emit(...)` looked for `emit` on the closure's own layout
and did not find it. The same sentence about a field reads "`v`, which `an
anonymous type` does not declare", which is why the two rows never looked
related. Seventeen of them were `this.emit` inside a callback, which is how
every stream in that codebase reports an error.

```ts
nts_net_read_start(this._handle, (bytes) => this.#inScope(() => { … }));
```

`this` travels as a capture like any other name now, first in the closure object
so its field index is stable. The machinery was already there — `mentions_this`
knew to stop at anything that rebinds `this` and to descend through arrows,
which is exactly the rule — it had only ever been used to explain a refusal for
`function` expressions.

The rows went 72 → 62 and 64 → 37, and the profile 1,095 → 1,065. What is left
of them is the part that really is structural.

This is the sharpest instance yet of the rule that a tall row is usually one
thing repeated. The plan was to build an interface dispatch table for these
sites. Ninety-three of them wanted a capture.

### A hundred objects that were all the same object

Escape analysis asks where a reference can be *reached from*. That is the right
question and it is not the only one. A frame allocation is a single slot, so
confining one is also a claim about *lifetime* — that at most one of its results
is live at a time. True of a straight-line `new`; false of one inside a cycle,
where the slot is reused and whatever kept the previous result is now looking at
the current one.

```ts
const balls: Ball[] = new Array(100);
for (let i = 0; i < 100; i += 1) {
  balls[i] = new Ball(random);   // one frame slot, a hundred objects
}
```

Every element pointed at the same slot and read back the last ball. The store
rule deferred the stored value's escape to the container's, the container was a
frame-local array, so the ball stayed in the frame — reachability said yes and
lifetime said no.

Found by `awfy-bounce`, which checks its own answer against the constant Are We
Fast Yet recorded: **1117 where node says 1331**. It had been failing in the
benchmark runner and the benchmark runner is not part of the gate. Nothing in
`examples/` stored into a container in a loop, so nothing else asked.

An allocation in a cycle can no longer be confined when something keeps it. A
block is in a cycle when it can reach itself, which is all this needs to know —
not which loop, not how many iterations — and it is used only to *refuse*
confinement, so over-approximating costs a heap allocation and never an answer.

It cost nothing where the analysis exists to help: `objects` 1.00x of
hand-written C++, `closures` 1.01x, `pipeline` 0.97x, `awfy-list` 1.08x, all
unchanged. An object allocated in a loop and *not* kept still lives in the
frame, and `examples/objects` now pins all three cases.

### A crash and a declined case are not the same thing

Twice this week the harness reported agreement over a program that had died.
`examples/map-and-set` segfaulted on every case under reference counting;
`examples/async` reached 263 of its 928 cases for the same reason, with the
cycle collector's blind spot sitting behind it. Both were filed as *declines*,
which do not fail a run.

The rule that was missing is narrow and exact. A decline is the program refusing
its input, and it **says so** -- `nts: refused: …` on stderr before it stops, so
a bounds check that aborts is still a decline. What was not distinguished is a
program killed by a signal that printed nothing at all. That is a crash, and it
now fails.

A timeout stays a decline: `timeout` exits of its own accord, so there is no
signal on the child, and a case that takes too long is not reached rather than
wrong.

The classification is a function with a test, which the version it replaces was
not: five cases, one per way a run has actually ended. And it was checked the
only way worth checking a detector -- by putting the collector bug back and
confirming the run fails, where the same program had previously reported
"agreed on every case".

### What the `rc` list was counting

It named `invalid`, `timers` and `unsupported`, and only one of those was about
reference counting.

`invalid` does not typecheck and `unsupported` is a refused construct. Both are
fixtures that must *fail*, and `gate.sh` has always inverted them for exactly
that reason -- the `rc` sweep did not, so two entries on a list of known
reference-counting failures were programs that would fail under any provider.

`timers` held 58 objects at the end: 29 cases times a pending 60-second timer
and the callback it had not run. The note beside it said "not a leak", which was
true and was not a *separation*. A pending timer is the **host's** state, and
the check claims to measure what the program still holds; the host was never
asked to give it back. The driver now drains the host before it measures, so the
number means what it says, and it is 0.

`module-state` came off earlier and was the reverse case: its note explained the
extra object as an artifact of taking the baseline too early, and it was a real
bug -- a module-scope initializer refused and silently dropped.

The list is empty and 90 of 90 examples pass under reference counting. Which is
worth one caution: an empty list is only as good as the check behind it, and
this same week that check reported "agreed on every case" over a program that
segfaulted before printing a line.

### The collector's blind spot was its own dying list

`allOfTwo` returning 0 where node returns 1 was the symptom this was tracked
under, and by the time it was looked at properly the wrong *answer* was gone --
it returns 1. What was left was worse and quieter: `examples/async` under
reference counting **checked 263 of its 928 cases and reported "agreed on every
case"**, because the driver was segfaulting and the harness gave up after
seventeen restarts.

One ASAN stack named it:

```
nts_collect_at_checkpoint -> nts_collect_cycles -> nts_destroy
  -> nts_release_contents -> nts_each_reference -> nts_release   [faults]
```

faulting on the values array `Promise.all` writes into.

`nts_destroy` links an object onto the dying list by storing the list's next
pointer **in the count word** -- there is nowhere else to put it, and the object
is going away. So a release arriving afterwards decrements a *pointer*. That
arrives constantly rather than rarely: `nts_release_contents` on one dying
object walks a field pointing at another, and the collector puts every
zero-count black root through the same drain in one pass, so two objects that
die together each release the other. The list ran into freed memory and the next
walk read it.

`nts_retain` and `nts_release` now ignore an object already on the list, marked
with a flag rather than inferred from the count word -- the flags are the only
part of the header still saying what the object is. Ignoring the release is
*right* rather than merely safe: the object is being freed either way, and the
reference being given up is one the destroy already accounts for.

928 of 928 cases now.

The route the collector could not walk was not the microtask queue, which was
the standing suspicion and is written up below as one. A queue is indeed no
object at all, and `nts_promise_schedule` does move a reaction's state into one
-- but it *moves* it, count and all, and a reference held outside the object
graph is exactly what Bacon-Rajan's count subtraction is built to tolerate. The
suspicion was reasonable and wrong, and the collector was wrong about something
it owned outright.

### `Promise.all` freed its result array three times

`nts_combinator_new` stored the values array without retaining it — a *move* —
while the compiler passes both arrays as ordinary arguments and releases them
after the call. The combinator's descriptor lists that field, so it released
what it had never acquired, and the array was freed three times: by the caller,
by the combinator, and by the result promise, which retains it at fulfilment.

It read as `Promise.all` answering wrongly, and only when something else
disturbed the allocator — freed memory nobody has reused still holds the right
numbers. Arguments are borrowed everywhere else in the runtime, so the fix is
the retain, and the combinator suite's own calls were relying on the move.

With it fixed, the cycle collector now runs at every **checkpoint**, where both
queues are empty by construction and the program is between jobs. 50,000 async
calls: 14ms holding 44 objects became 9ms holding none — faster, because memory
reused promptly beats memory that grows. The ten-thousand-root threshold stays
for programs that never reach a checkpoint.

I first reported an async call as leaking `awaits + 1` objects under counting.
It does not, and the correction is worth keeping: what accumulates is
**promises**, which are cyclic-capable, so at a count of zero they go to the
cycle collector's candidate buffer rather than being freed on the spot.

A short program ends before the collector's ten-thousand-root threshold, which
is what made it look like a leak. Measured across twenty thousand calls the live
count stays flat, and a forced `nts_collect_cycles()` takes it to zero. The
frames themselves are balanced — 101 allocated and 101 freed over 101 calls —
which is the part this section is about.

`bigint`'s width is the one place this table promises less than the language.
Within it the arithmetic is exact and prints without an exponent, and the one
value it cannot spell is `-(2^127)`: the literal is written as a negation of
`2^127`, whose magnitude does not fit, so it is refused by name.

Three things about it were wrong until a generated sweep asked node. `String()`
of one was refused. A literal above 2^63 emitted its digits, which C has no
literal type for and clang rejects outright. And `1n << 100n` folded to `16`,
because the constant lattice describes *doubles* — a range, whether the value is
whole, whether it could be `-0` — and was still being asked about a value that
is none of those. 100 masked to five bits is 4.
The boundary is deliberate and visible: a literal too large is refused where it
is written. Every `bigint` in the node profile is a 64-bit quantity —
`readBigUInt64BE`, an hrtime timestamp, `0xffffffffffffffffn` — and a true
bignum would put a heap allocation into each of them. What replaces it, when
something needs `2n ** 200n`, is a small-integer fast path beside a heap bignum.

`BigInt(x)` is `Number(x)`'s mirror and not quite its twin. The identity on a
bigint and `0n`/`1n` on a boolean are both what a C cast already is. On a
*number* it is a conversion with a precondition: the specification throws a
`RangeError` when the value is not an integer, so `BigInt(1.5)` is not `1n` and
a cast would be a wrong answer rather than a lossy one. `nts_bigint_from_number`
checks and refuses, the way an index past the end of an array does, and refuses
again above 2^127 " + D + " the same boundary the literals have. From a *string* it is a
parse, which `parseInt` would need too and neither has.

That closed 22 sites reading "a builtin this compiler does not provide", and
**5,875 to 5,821** across the profile: closing it let lowering reach 32 more
things that were behind it.

And what the representation is worth, which the table now carries: the `bigint`
row is **0.99x C++ and 0.09x node**. C++ there is hand-written `__int128`, so
this matches the floor; node's `BigInt` is arbitrary precision and allocates,
and pays eleven times over for a width no `readBigUInt64BE` needs.

It is also its own `HirType` rather than a wide integer, and that is not
bookkeeping: `1n << 40n` is 2^40 where `1 << 40` is 256, because a *number*'s
shift masks its count to five bits. Sharing the integer type let constant
folding answer the number's question, silently and correctly by its own lights.

## 8. ECMAScript globals

The whole global object, host additions excluded. `∅` rows are §13, not backlog.

| group | ✅ | ✗ gap | ∅ not a goal |
|---|---|---|---|
| value properties | `Infinity`, `NaN`, `undefined` | | `globalThis` |
| function properties | `isNaN`, `isFinite` | `parseInt`, `parseFloat`, `encodeURI(Component)`, `decodeURI(Component)` | `eval` |
| fundamental | `String` (as a function), `Number` | `Object` ◐, `Boolean`, `Symbol` | `Function`, `Proxy`, `Reflect` |
| errors | `Error`, `TypeError`, `RangeError`, `URIError`, `ReferenceError`, `SyntaxError`, `EvalError`, `AggregateError` | `SuppressedError` | |
| numbers, dates | `Math` ◐, `Number` ◐, `Date` ◐ | `BigInt` | |
| text | `String.prototype` ◐ | `RegExp` | |
| indexed | `Array` ◐, eight typed arrays ◐ | `Array` statics, `Uint8ClampedArray`, `Float16Array`, `BigInt64Array`, `BigUint64Array` | |
| keyed | | `Map`, `Set`, `WeakMap`, `WeakSet` | |
| structured | `ArrayBuffer` ◐ — length, maximum, `resizable`, `detached`, `slice`, `resize`, `transfer`, `transferToFixedLength`. `DataView` ◐ — construction over a buffer, tracking and fixed windows, `buffer`, `byteOffset`, `byteLength`, and every `get`/`set` — the eight numeric widths with explicit endianness, and the `BigInt64`/`BigUint64` pair | `JSON`, `Atomics`, `SharedArrayBuffer` | `DataView` is `ManagedType::DataView`, which carries nothing: its width is chosen per *access* by the method called, so `getUint8` and `getFloat64` are two calls on one type rather than two types. The bigint pair works because a bigint already crosses the boundary as a value — `__int128` on C, `NtsBigInt` on the JVM — so it needed an arm rather than a mechanism |
| memory | | `WeakRef`, `FinalizationRegistry` | |
| control | `Promise` ◐ — the constructor, `all`, `race` | `Iterator`, generator objects | |
| internationalization | | | `Intl` — ECMA-402, a separate specification |

The errors row was wrong in the direction that makes the gap look bigger, and was corrected on 2026-09-13 by throwing all nine and reading what refused: **seven compile, two do not.** `ReferenceError`, `SyntaxError` and `EvalError` had been listed as gaps while sitting in `hir::builtin::ERRORS` — a second derivation of that list, disagreeing with it.

**Both gaps shared one reason and it was the list's own premise**: its members held `{ message, name }` and nothing else, so a class with a third field could not join it. `AggregateError` carries `errors`; `SuppressedError` carries `error` and `suppressed`.

`AggregateError` **landed the same day**, and the premise is what it cost to move: `builtin::error_fields` now takes the class it is building and appends `errors` for that one. Three things followed from the field rather than from the name. The field is **erased** rather than `Array(Erased)` — an array of pointers is not an array of tagged values, so the first spelling made the verifier reject a store that is a per-element conversion rather than a cast. It is **stored rather than omitted**, which `builtin::OMITTED` could not express: nothing in `runtime/node` reads `.errors`, so omitting it would have cost nothing a reader could see, and three sites *construct* one with it — a constructor argument accepted and discarded is a wrong answer that runs, and `OMITTED` names a member so that *reading* it says why it is absent and says nothing about writing. And the **message is second**, `new AggregateError(errors, message?, options?)`, so the options check — `arguments.len() > 1` — refused it as “an `Error` with options” until it counted from where the options argument actually is rather than from a constant. **The field is written and not read**, and that asymmetry was forced by the backends rather than chosen. Reading it back yields an erased value where the checker says `any[]`, and the narrowing cannot bridge that: the emission loaded `{ i32, i64 }` and then indexed it as a `ptr`, which **clang rejected and the C backend accepted** — agreeing with node on every case while the LLVM step could not build the same program. One backend refusing to compile is loud; the other answering correctly by coincidence is the shape that survives, so the read is refused by name. `blockers/an-aggregate-errors-read` holds it with the pair of behaviours and what closing it needs: an element-wise conversion at one end or the other, with no site asking for one. `examples/the-provided-error-classes` runs eight classes over 203 cases against 174, and `aggregated` varies the array's length three ways — so the store must not disturb the two fields beside it, and an array written into an erased slot must survive construction, `throw` and `catch` without taking `message` with it.

`AggregateError`'s absence is not confined to where it is thrown, and `hir::builtin` says so in its own comment — *a class absent from this list does not merely fail where it is thrown; it refuses its caller, and its caller's caller*. Followed to the end, measured rather than argued:

```text
AggregateError absent from builtin::ERRORS
  -> NodeAggregateError extends it, so has no layout
     -> `value.code` over five instanceof-narrowed arms refuses, as
        `code` on a union one of whose members has no layout
        internal/errors.ts:1256, and that file is imported by every module
```

`refusal-census.mjs --top=204` reads that message at 6 things, 7 sites, 24 modules. The 24 is cone-reach rather than 24 independent problems, which is how the census's own header says to read it. A probe ruled out the obvious alternative first: a user class carrying an array field compiles and reads `.code` through a union perfectly well, so it is **the base being unprovided** and not the array.

### `Object` is two halves

They belong in different columns and putting them in one is what made this
table read as a backlog:

- **Done, and without a hash table.** `keys` and `hasOwn` are answered by the
  *layout*: the field names in declaration order, which is what a base-first
  layout is, and a constant `true`/`false` for a key the compiler can see.
  `Array.isArray` is the same idea one type over — and the reason it is not a
  one-liner is that it must ask the **checker's** type, not the
  representation: a `Uint8Array` is an `NtsArray` here and
  `Array.isArray(new Uint8Array(4))` is `false` in node.
- **Still a gap.** `entries values assign fromEntries is groupBy`. `entries`
  wants the tuple representation (which now exists) plus an array of them;
  `is` wants `SameValue`, which is `===` with the `NaN` and `±0` rules
  inverted.
- **Not a goal.** `defineProperty getOwnPropertyDescriptor(s) create
  getPrototypeOf setPrototypeOf freeze seal preventExtensions isFrozen isSealed
  isExtensible`, and `Object.prototype`'s methods. Each needs a property map
  and a prototype chain at run time; see §13.

### `pop` and `at` answered NaN for `undefined`

Both are typed `T | undefined` by the checker, and for a number that is an
erased value with a tag of its own. They returned a `double` instead, with this
written above them:

```c
/* Popping nothing is `undefined`, which for a number is NaN. */
```

It is not. `String([].pop())` is `"undefined"` in node and was `"NaN"` here;
`?? 0` takes the one and not the other; `=== undefined` separates them. The
comment asserted the equivalence rather than checking it, and nothing asked
until the sweep grew a row for an **empty** array — every array cell in it had
three elements, so the case that distinguishes them had never run.

Both now answer from the tag, and the double-returning helpers remain for
callers who narrowed the result back to a number, which costs those nothing.

An `xs.at(i)!` is the one caller that can still be wrong, and it is wrong by its
own assertion: the `!` tells the checker the index is in range, so the payload
is read out directly, and when the index is not in range that read gets whatever
is in the slot. It gets NaN — the same answer the numeric helper gives — rather
than the zero an `undefined` value otherwise carries, so a program that lied
gets one wrong answer instead of two different ones.

### `String()` of an absent pointer handed a null to the concatenation

A `string | null` is one pointer, and `String()` on it returned that pointer
unchanged. For the null that is not text at all: the program aborted on the
first thing that read it.

Which is worth recording for *how* it hid. The differential reports an aborted
case as **declined**, separately from a disagreement, because a program that
stopped has no answer to compare — and "agreed on every case" is printed
alongside. Seventeen declined cases sat under a green line, and only the second
reading of the same output found them. `String(null)` is `"null"` and
`String(undefined)` is `"undefined"`; which one is a property of the type, and
where the type is *nothing but* the absence there is no branch to emit at all.

### A refused initializer was dropped and its readers were compiled

A module-scope declaration whose initializer cannot lower is refused *by
itself*, so that one bad declaration does not darken a whole module's
evaluation. The variable was kept, though, and every function reading it was
emitted — against a global that module evaluation never writes.

```ts
const source: unknown = { a: 1 };
let rendered: string = String(source);   // refused: no conversion from unknown
export function go(n: number): number {
  return rendered.length + n;            // emitted, against a null pointer
}
```

The refusal was printed. The program was produced. And the differential said
`checked 0 of 29 cases` and `agreed on every case`, one line apart.

Both halves are fixed. The declarations whose initializer cannot lower are found
*before* any function is lowered and recorded on the module, so reading one
refuses — asked before the global slot, because such a variable has both a slot
and nothing to put in it. And `agreed()` now requires that something was
checked: a run that reached nothing agreed on nothing. Every case declining is
how a program that stops on all input looks from here.

That second fix found the next one immediately. `examples/map-and-set` had been
*segfaulting on every case* under reference counting while the gate counted it
as passing, because stdout to a pipe is buffered and a crash loses it — zero
lines, no diagnostic, and an agreement over an empty set.

### `map.set` handed back the table it never retained

The crash was `stringKeys` releasing the same `NtsMap` four times: once for the
map and once for each `set`, because `set` returns its receiver so that
`m.set(k, v).size` means something, and returning it hands out a reference the
function never took.

`get` had the mirror of it — the value came out of the slot unchanged, so
reading one key five times released it five times while the table still held it
— and so did both cursor reads a `for...of` uses. All four are the same
sentence: a parameter is borrowed and a call's result is owned.

Every function in that example stored *numbers*, which is why none of it ever
showed. It now has three that store references.

### `fill` and `reverse` handed back a reference they never took

A parameter is borrowed and a call's result is owned. Both work in place and
return their receiver — which is what makes `xs.fill(0).length` mean something
— and neither retained it, so the caller released its own reference *and* the
one it was handed, and the array was freed while still in use.

Invisible under NoGC, which frees nothing, and invisible under reference
counting too until an expression used the array on both sides of the call:
`xs.slice(1)` and `xs.reverse()[0]` in one `return`. Then the live count went
*negative* and the sliced elements read back as whatever had been allocated over
them. Five helpers had it — the three `fill`s and both `reverse`s — and it had
been there as long as they had.

The lesson is about where it was found rather than what it was. `tooling/gate/rc.sh`
runs every example under the counting provider and asks whether the program
returns to its baseline; that check has been green throughout, because no
example had ever written the two calls in one expression. A conservation law is
only as good as the programs it is asked about.

### The profile had invalid HIR and no step read the line

`invalid HIR 0` is the *corpus's* number, over single-file cases the suite
generates. It says nothing about the largest body of TypeScript this compiler
sees, and `nts hir` had been printing `the prepared program does NOT verify` for
`path` and `url` with nothing reading it.

The same shape as two things already recorded here: the profile itself existed
as a measurement for months before any gate step emitted it, and `uncompilable
C` was 15 and invisible. A number that counts one thing gets quoted as though it
counted the others.

The gate now verifies every profile module, ratcheted downward like the `rc`
list, and the list is empty. Both were `MissingCallee { callee:
"Closure34#call" }`: `drop_callers_of_refused` removes a closure whose body
calls something refused, and the dispatch that reached it is handled --
reachability nulls a table entry naming a function that is gone -- but
`monomorphize` then wrote that same name into a `Callee::Direct` for a clone,
and nothing looks at a direct call again. A clone exists to turn a dispatch into
a call by name and is only worth making while the name still refers to
something.

Adding that check immediately caught a third module. `util` stopped verifying
when `Boolean(x)` started lowering, on

```ts
Boolean(candidate._readableState || candidate.pipe && candidate.on)
```

— a `||` with an object on one arm and a boolean on another. The join takes the
whole expression's type, so one arm agreed with it and the other was handed over
unchanged, reaching the verifier as `expected: Managed(Object(606)), found:
Bool`. `coerce` had a bare `return Ok(value)` as its last line, which said yes
to everything left. It now refuses a scalar where a reference is wanted and the
reverse; two managed types still pass, because base-first layout makes an upcast
a no-op.

Worth stating plainly: the refusal count *fell from 1,005 to 854* while that was
happening, and 151 of that drop was functions being accepted with invalid HIR
rather than refused. A number that only goes down is not the same as progress.

It then rose to 1,097 when the two modules were fixed, because a module that
does not verify does not finish emitting either, and the refusals past the point
it stopped were never counted. Both movements are the same fact: the reach
number is only meaningful over programs that are valid, and nothing had been
asking whether they were.

### The verifier accepted a multiplication of a tagged value

`nts hir` said "all of it verifies" over

```
%2 = const undefined : erased
%5 = mul %2, %4 : f64
```

which the C backend then emitted as a cast of a struct to a double. The block
was unreachable — the checker had narrowed the operand to `never` — so nothing
would have run wrongly, but nothing would have *compiled* either.

The verifier checked calls, stores, block arguments and dominance, and never an
ordinary operator's operands. It does now, for the one rule with a case behind
it: arithmetic, ordering and the bitwise operators cannot read an erased value.
`Eq` and `Ne` are excluded deliberately — comparing two erased values is what
carrying a tag is *for*.

`invalid HIR 0` had been counting a question nobody asked.

### ES2026 additions, and the oracle's ceiling

The examples gate compares against node, so an addition node does not have is
one this compiler cannot differentially test. Measured against node 24:

| in node, testable | not in node yet |
|---|---|
| `Error.isError`, `RegExp.escape`, `Iterator.from`, `Map.groupBy`, `Object.groupBy`, `Promise.try`, `Promise.withResolvers`, `Math.f16round`, `Set` composition (`union` and the rest), `Array.fromAsync`, `Array.prototype.with`/`toSorted`/`toSpliced`/`toReversed`, `JSON.rawJSON`, `Float16Array`, `String.prototype.isWellFormed` | `Iterator.concat`, `Map.prototype.getOrInsert(Computed)`, `Math.sumPrecise`, `Uint8Array.fromBase64`/`toHex` |

### What ◐ covers

Measured, not assumed — three of these rows were wrong on the first pass.

- **`Math`**: `abs acos asin atan atan2 cbrt ceil cos cosh exp expm1 floor
  fround hypot log log10 log1p log2 max min pow round sign sin sinh sqrt tan
  tanh trunc`, and the constants. Absent: `random`, which needs a decision
  about its source rather than an implementation.
- **`Number`**: `isNaN isFinite isInteger isSafeInteger EPSILON`, and
  `toString` on a number — which is `String(x)`, and is ECMAScript's
  Number::toString rather than a `printf`: the shortest decimal that reads back
  as the same double. quickjs-ng's `js_dtoa` computes it, an integer takes a
  digit-pair loop written here instead, and the result lands in the frame
  because its length is bounded before the call. Record 0034.

  Absent, and now for want of wiring rather than for want of an algorithm:
  `toFixed`, `toPrecision` and `toExponential` are `js_dtoa`'s `FORMAT_FIXED`
  and `FORMAT_FRAC` with the `EXP_*` flags, and `parseFloat`/`parseInt` are
  `js_atod` — all four already vendored and compiled in, none of them
  reachable from a program yet.
- **`String.prototype`**: `at charAt charCodeAt codePointAt concat endsWith
  includes indexOf isWellFormed lastIndexOf padEnd padStart repeat replace
  replaceAll slice split startsWith substring toString toWellFormed trim
  trimEnd trimStart valueOf length`, and the statics `fromCharCode` and
  `fromCodePoint`. This list said `at`, `split`, `replace` and `trim` were
  absent long after they were not.

  `repeat` **throws** for a count the language refuses — negative or
  `+Infinity`, per `ToIntegerOrInfinity` — rather than clamping it to zero and
  answering `""`, which is what it did and which node does not. The test is at
  the call because a runtime helper cannot throw: a handler is a block and a
  `throw` is a jump the lowering writes. It was invisible for as long as it
  existed, because the differential's node driver died on the first synchronous
  throw and every case after it went unasked. Record 0175.

  `toLowerCase` and `toUpperCase` are there because the tables are:
  quickjs-ng's `libunicode` is vendored under `runtime/c/quickjs`, MIT, and
  emitted only
  for a program that calls one of them — linking it always would take
  `examples/hello` from 81 KB to 162 KB. That closed 39 refusal sites in the
  node profile. Record 0033.

  Absent, and each for its own reason rather than for want of writing it:
  `normalize` has its tables now and is not yet wired (3 sites); the `toLocale`
  pair is deliberately **not** aliased onto the plain forms, because
  `toLocaleUpperCase` of `i` in Turkish is `\u0130` and answering it with the
  locale-independent mapping would be wrong rather than approximate;
  `localeCompare` wants ICU; `match`, `matchAll`, `search` and the *pattern*
  forms of `replace` and `split` want a regular expression engine, which is
  refused as its own feature; `String.raw` waits on tagged templates. Indexing
  (`s[0]`) is refused as "indexing a representable type, which is not an
  array".

  `isWellFormed` and `toWellFormed` are ES2024, and this paragraph said for one
  commit that they were written, could not be reached, and were taken out again
  because the fixtures were pinned to ES2022. That was true of the fixtures and
  is what got the target changed: the programs are ESNext now and both are back,
  in the differential. A target is not a detail of the build — it decides which
  language the compiler is a compiler for.
- **`Array.prototype`**: `at every fill filter find findIndex forEach includes
  concat indexOf lastIndexOf map pop push reduce reverse shift slice some
  splice unshift length` on an array of numbers, and `at concat every filter
  find findIndex forEach includes indexOf map pop push reduce reverse shift
  slice some splice unshift length` — plus `join` — on an array of
  *references*. `push` and
  `unshift` take as many elements as they are given; `splice` takes two
  arguments, and the insert form is a different signature rather than a longer
  one, and `concat` takes one array. Absent: `sort`, `flat`, `flatMap`,
  `findLast`, `findLastIndex`, `reduceRight`, `toSorted`, `toReversed`, and
  everything on an array of booleans.

  `concat` in JavaScript takes any number of arguments and *spreads* the ones
  that are arrays while appending the ones that are not — two questions the
  checker can answer and a runtime helper cannot. One array argument is the
  shape worth a helper; the rest is refused by name rather than answered
  wrongly.

  `some`, `every`, `findIndex`, `find` and `filter` are compiled as the loops
  they are, like `forEach`, `map` and `reduce` before them: the callback inlined,
  no closure allocated, no indirect call. The first four stop early, which is one
  mechanism they share; `filter` allocates once, as long as its input, and is
  shortened to what it kept.

  What is absent is absent by *count*. `shift`, `unshift` and `splice` are here
  because `runtime/node` uses them seventeen, sixteen and twelve times; `flat`,
  `flatMap`, `findLast`, `findLastIndex`, `reduceRight` and `toReversed` are
  not, because it uses them zero times between them.

  Every one of those twelve `splice` calls throws its result away, and this
  still allocates the removed run for them. A `_void` form chosen where the
  result is dead is the fix, and it is a question about the caller.

  The 22 profile sites that wanted a method on a non-numeric array all wanted a
  reference element — strings, objects, closures, an `Int32Array` — and not one
  wanted booleans, so there is no `_bool` family. Three questions change with
  the element and nothing else does: `pop` and `at` answer `T | undefined`,
  which for a reference *is* the null pointer and needs no tag; `indexOf`
  compares by `===`, which on a string is value equality, so
  `["a"].indexOf("a")` is 0 across two separately built strings and a pointer
  comparison would answer -1; and every element crossing the boundary is a
  reference count.
- **Typed arrays**: the constructor from a length, indexing, `length`,
  subclassing. Absent: construction from a value, `fill set subarray slice
  indexOf`, `buffer byteLength byteOffset` — 49 refusals in the node profile,
  reachable only since `extends Uint8Array` began lowering.

## 9. Abstract operations

The conversions and comparisons every operator rests on. They are implemented
where they are reachable rather than as a library, so this is a list of what
the lowering can currently produce — and the gaps here are why some operators
above are refused.

| | | |
|---|---|---|
| ✅ | `ToBoolean` — including the tag switch for an erased value `examples/erased-truthiness` carries the erased half — `!x` where `x` is `unknown`, which is the tag switch this row names. |
| ✅ | `ToString` on a number (`nts_number_to_string`) `examples/number-strings` carries the requirement this row's helper exists to meet, and states it: `String(n)` is not a `printf` conversion — ECMAScript asks for the *shortest* decimal that round-trips, which is why there is a named helper rather than a format string. `examples/number-tostring-radix` carries the `toString(radix)` form and `examples/number-from-string` the inverse direction. |
| ✅ | `ToInt32`, `ToUint32` — the bitwise operators `examples/bitwise` carries the operators these conversions are the meaning of; the conversions have no spelling of their own in a program, which is why this row names them and the example cannot. |
| ✅ | `ToIntegerOrInfinity`, `ToLength`, `ToIndex` — array bounds `examples/an-out-of-range-read-the-program-handles` carries the bound being reached — a read past the end where the source is handling the absence itself. |
| ✅ | `ToUint8`/`ToInt8`/`ToUint16`… — storing into a typed array — `examples/string-methods` |
| ✅ | strict equality on numbers and strings — `examples/identity-across-subtype` |
| ✅ | relational comparison — `<` `<=` `>` `>=` — on numbers, and on strings by UTF-16 **code unit** | not `strcmp` and not `memcmp`: a narrow and a wide string compare a byte against a code unit, and above the BMP code-unit order disagrees with code-point order — `"\u{1F600}" < "\uFFFD"` is true because the leading surrogate is 0xD83D. This row read ✅ while both backends compared **addresses**; the sweep had no cell for a relational operator, and now has one `examples/a-comparison-through-valueof` carries the case that decides what these operators do to an object receiver, since a relational comparison is where `ToPrimitive` is reached. |
| ✅ | `ToNumber`, in both its spellings | **the row said a numeric string was refused and that was stale; unary `+` was the half that was actually wrong.** `Number(x)` had the arms all along — a string through `nts_str_to_number`, which is StringToNumber's grammar rather than `strtod` (it trims, takes three radix prefixes C does not and rejects three spellings C does), a boolean and a `bigint` through C's own conversion, and an erased value whose type admits no object through `nts_value_to_number`. Unary `+` was *dropped* instead: correct on something already typed `number`, where it is the identity including on `-0`, and wrong on everything else — `+s` on a string returned the string and the C backend emitted `(double)v1` on a pointer. **A conversion that is the identity for one type is not the identity.** One function answers both now, so an arm cannot be present in one spelling and missing in the other. 44 cases across six functions agreeing with node. The object case is the row below, and it is a different feature `examples/a-unary-plus-is-a-conversion` carries both — it is named for the half that reads as an operator, `+x` being `ToNumber(x)`, the same operation `Number(x)` is. |
| ◐ | `ToPrimitive`, `OrdinaryToPrimitive` — `valueOf`/`toString` dispatch | **hint `number` for a relational comparison landed 2026-09-13**, and it is a *static* dispatch rather than a prototype walk: `valueOf` and `toString` are members this compiler already puts on the descriptor, so "does this object have a `valueOf`" is a question about the type. The ordering is the whole of it — `valueOf`, then `toString`, then refuse — which is what `blockers/a-relational-comparison-between-objects` predicted when it called this "reachable machinery wanting an ordering rather than missing machinery". `examples/a-comparison-through-valueof` is 87 cases across three functions on C, LLVM and the JVM, and its third arm is the **specification rather than a convenience**: `valueOf()` returning an *object* falls through to `toString`, and an implementation that took the first method it found would compare two pointers again, silently. What remains: an object with **neither** method, where JavaScript throws a `TypeError` and this compiler has no cross-call throw to do it with; two sides converting to *different* primitives, which needs the second conversion the specification does after the first; and hint `string`, which nothing reaches — `` `${o}` `` and `String(o)` are refused by their own rows |
| ◐ | `SameValue`, `SameValueZero` — wanted by `Object.is`, `Map`, `Set`, `includes` | **`SameValue` is there as of 2026-09-12, through `Object.is`.** It is `===` with two corrections and agrees with it about everything else, so it is a comparison plus two tests rather than a comparison of its own — the specification's own phrasing, `if (x === y) return x !== 0 \|\| 1/x === 1/y; return x !== x && y !== y`. `1/x === 1/y` separates the zeroes without a sign test and `x !== x` is true only of `NaN`, so this needed **no runtime helper and no new operation**: the existing `Eq`, `Ne` and `Div`, arranged as the specification arranges them. Only where both sides are numbers — a string has neither special case, and every arm here is a value rather than an expression, so the numeric dance emitted for one would be `1 / "a"`. **`SameValueZero` is not** — it shares the `NaN` half and not the zero half, and its callers are `includes` and the deferred `Map`/`Set`. `examples/object-is`, 290 cases over ten exports including both zeroes and the infinities, C, LLVM and JVM |
| ◐ | loose equality (`==`) — legal in strict code and still specified | **the row said ✗ and section 1 said the opposite; section 1 was right.** `x == null` is lowered, in both the erased and the typed case: an erased value gets one comparison per tag joined by De Morgan — `== null` is "either", `!= null` is "neither" — and a typed one is answered from the type, which is what remembers whether a pointer's absence is `null` or `undefined`. `examples/absent` has covered it all along. **That is also the only loose comparison the corpus writes: 55 of `runtime/node`'s 62 `==`/`!=` occurrences are against `null`, and the other 7 are in `util/deep-equal.ts` and its own documentation.** What is refused is the coercing case — `1 == true`, `[1] == 1` — and only where a side is erased, since the checker rejects a comparison between concrete types that disagree. That refusal wants `ToPrimitive`, which is the row two above and which nothing in the corpus asks for |
| ◐ | `ToBigInt` **from a string** is the gap; from a number, a boolean and through arithmetic it is answered | **measured 2026-09-13, and the row was a title over a family that is mostly landed.** `BigInt(n)`, `BigInt(b)` where `b` is a boolean, `a * b + a` on two bigints, and `BigInt.asIntN(8, x)` all lower and agree with node across **116 cases in four functions**. The one that refuses is `BigInt("12" + n)` — `a conversion to bigint from this type` — which is the string parse, and is the same shape as `ToNumber` from a numeric string one section up rather than anything about bigints. `ToBigInt64`/`ToBigUint64` are the typed-array element conversions and are named in the `BigInt64Array` row, which is where their obstacle is: this bigint is 128 bits |
| ∅ | `ToObject`, `ToPropertyKey` — need boxing and a property map |

## 10. The iteration protocol

What `for...of`, spread, destructuring and the combinators are all specified in
terms of. The protocol object still does not exist — and most of what was
waiting on it no longer is, because a `for...of` over a *known* shape never
needed one.

One walk serves all three shapes: a cursor and three questions — where it
starts, whether it is still going, what it reads. That is what let `break`,
`continue` and the loop-carried names be solved once instead of three times.

| | | |
|---|---|---|
| ✅ | `for...of` over an array — a counted loop, unchanged `examples/iteration` carries it beside the other two walks, which is what shows the array case really is the counted one. |
| ✅ | over a `Set`, and over `map.keys()` / `map.values()` — the table read directly, no iterator allocated — `examples/iteration`, `for (const k of m.keys())` and `for (const v of m.values())` |
| ✅ | over a `Map` and `map.entries()`, bound as `[key, value]` — two names, two reads, no pair built — `examples/iteration`, `for (const [k, v] of m.entries())` and the same over a `Set` |
| ✅ | over a string, **by code point**: `"a\u{1F600}b"` yields three items, not four — `examples/array-from` and `examples/iteration`, both on the surrogate pair itself |
| ✅ | array and object destructuring, including nested and renamed — in a declaration **and in the head**: `for (const { from: { x }, weight } of segments)` binds by property off the element, where `[key, value]` over a table stays positional because those two names take two reads and no pair is ever built — `examples/destructuring`, which carries both the object and the array form |
| ✅ | mutation during a walk: an entry appended is visited, one deleted ahead is not — `examples/growable`, an array that grows while it is walked |
| ✅ | `[Symbol.iterator]()`, `.next()`, `{ value, done }` — the object itself, where the result type is written out | the fourth walk and the only one with no cursor: `next()` both advances the iterator and produces the element, so one call answers "again?" in the header and "with what?" in the body, which the header dominates. The header is the latch, because `continue` has to reach the step — `examples/a-generator-method` and `examples/array-from` |
| ✗ | `IteratorResult<T>` from `lib.d.ts` | a union of two object types whose `value` is `T` in one and `any` in the other, so they lay out differently and the union has no representation. A hand-written `{ value: T; done: boolean }` works; the standard spelling is refused and named |
| ✗ | iterator **closing** (`.return()` on abrupt completion) | a correctness detail, not a convenience, and generators are what made it observable: a `for...of` left by `break` calls `gen.return()`, which resumes the generator inside its `try` so the `finally` runs. A generator whose `finally` incremented a counter disagreed with node on **26 of 29 cases**, so a `finally` spanning a `yield` is refused by name. A `catch` spanning one is not, and that is measured: 29 of 29 agree. **The refusal is broader than the defect, measured 2026-09-13 by lifting it and running rather than by reading it.** Of three shapes, only one is wrong: a generator walked **to exhaustion** agrees with node — the split preserves the `finally` block and the resumption walks into it like any other — and the `catch` control agrees. `leftByBreak` is the whole of it, answering 0 where node answers 1. So what is missing is `gen.return()` alone, not the `finally` in a suspended function. Narrowing the check from *the generator's `try`* to *a walk that can exit abruptly over a generator that guards a yield* would let exhaustive walks compile with correct answers; the ledger's stated reason for refusing at the generator — that the loop is in another function — is true of the check and not of the question, which a whole-program set answers the way `Naming::throwing` and `Naming::presence_keys` already do. **How many of the 16 corpus refusals that clears is unmeasured, and is the number to take before building it**: a narrowing that clears none is a refusal moved rather than a program compiled. **Six distinct sites, not the sixteen first written here**: 16 is refusal *lines* summed over module cones, and a cone contains the modules it imports, so one site is counted once per importer. Printed rather than counted they are `fs/promises`' `watch`, `stream`'s `createBatchedAsyncIterator`, `createAsyncPipeline`, `createAsyncIterator` and `map`, and `timers/promises`' `setInterval` — and **every one is an `async function*`**, so none was reachable until async generators started compiling the day before. This row's corpus did not grow; the refusal in front of it moved. Both the synchronous and asynchronous pairs split the same way. `blockers/a-finally-that-spans-a-yield` holds all five shapes **Reconfirmed 2026-09-13, and the confirmation needed a `finally`.** A `for...of` left by `break` over a generator **compiles** and agrees with node when the generator has no `finally` — because closing is unobservable then, so the probe measures nothing. Put a `finally` in the generator that records whether it ran and the refusal appears immediately and by name: `a `finally` that spans a `yield`, which is iterator closing`, held by `blockers/a-finally-that-spans-a-yield`. The reduced version is the one anybody writes first, and it says the row is stale. |
| ✅ | `for...of` over a user type with `[Symbol.iterator]` | `break` and `continue` both correct, nested walks independent, the iterator built once per loop. Allocates **nothing**: the result object is one frame slot reused, because each dies before the next is made — `tooling/memory/cases/iterator-protocol` argues it — `examples/a-generator-method`, `examples/array-from` and `examples/iteration` |
| ✅ | `for...of` over a **generator** | the fifth walk and the second with no cursor. One call to the resumption and one field read an element; **nothing allocated per element and no `{ value, done }` at all**, so a walk of any length allocates once. 1.07x hand-written C++, 0.05x node `examples/a-generator-walked-elsewhere` carries the case where the walk is not where the generator was made. |
| ✅ | `Array.from(xs)` over **anything iterable** | the walk with an append where the body would be, so every shape `for...of` knows arrives for nothing: an array, a typed array, a string by code point, a `Map` or `Set`, a user type with `[Symbol.iterator]`, and a generator. An array source keeps its `slice` — measured, 53.07 us against 462.77 us walking, and sliced it beats node — and the three sources that know their length before they start are allocated at it rather than grown `examples/array-from` carries it as the walk with an append, and `examples/array-from-unsupported` the forms this compiler refuses, which is where the edge of the row is. |
| ◐ | `Array.from` with a **mapping callback** is answered as of 2026-09-13; over an **array-like** is not | the two-argument form is two features under one name, and only one of them is an iteration. With an iterable it is `map` over the walk: `Array.from(xs, f)` calls `f` with each element and its index, and `Array.from(xs).map(f)` calls it with the same two arguments in the same order over the same elements — `map`'s third is the array, which this compiler passes to neither — and `Array.from` produces no holes, so the one thing `map` does differently cannot arise. So it is **two proven paths composed rather than a third written**: the walk that already handles every shape `for...of` knows, and the callback inlining that allocates nothing per element and calls nothing indirectly. The cost is one intermediate array, stated rather than hidden; fusing it away needs `iteration_delivery` to write into a destination being *grown* rather than indexed, and now has a measurement to beat rather than an argument to win. **The element type has two sources and that is where the bug was**: without a callback the built array's element is the expression's type, and with one it cannot be — `Array.from("abc", (c) => c.length)` has expression type `number[]` while the walk produces strings, so taking it from the expression coerced a string into a double. One of four arms changes the element's type and it is the only one that could have caught it. `examples/array-from-with-a-callback`, **203 cases across seven exports** on C, LLVM and the JVM, over an array, a string, a generator, a `Set`, with an index and with a block-bodied callback. **Zero corpus demand, measured**: the refusal appears 0 times in `stream`, `fs`, `util`, `http` and `buffer`, before and after. A spec row closed with no axis movement. `{ length: n }` still refuses and refuses as itself — `a for...of over an object type`, which is what it is: an array-like is read by index, and `Array.from({ length: 4 })` builds four `undefined`s out of an object with no elements |
| ◐ | spread over an iterable; `new Map([[k, v]])`, `new Set([...])` — the constructors and the spread still want an array |
| ✅ | a **generator method** — `*named()` and `*[Symbol.iterator]()` on a class | three halves, and the middle one is why it took two attempts. The declaration is fifteen lines; the *call* needed a route from a receiver type and a member name to a declaration node, because a generator's result is its **frame** and not the `Generator<T, …>` the checker says. That is `PropertyRecord::declaration`, put on the record rather than in a map beside it by asking **what the fact is about** — "where was this member declared" is about the member. And the walk: a frame is *resumed*, not `next`ed, so `protocol_walk` hands off to `generator_walk` after pushing the call, because a generator is walked where it was made. The JVM backend needed nothing. 26 `Symbol.iterator` sites, 29 `function*`, 117 `yield`. Record 0293 `examples/a-generator-method` carries it, which is how a class is made iterable. |
| ✅ | a **structural cast that is not a prefix** — a class passed where an interface is wanted | a compiled reference is a pointer, so this is a pointer cast, sound only where the target's fields are the source's first fields. It is now a **copy of the callee over the concrete type**, reading each field at that class's offset — no cast and no dispatch. The plain version stays, because a structural copy is an addition where a generic instantiation is a replacement. Chosen over laying the interface out like its implementor because a prefix buys the JVM nothing (it relates classes by name) and because on **ART there is no inline cache**: a monomorphic interface call is 1.97x a direct read, not HotSpot's 1.04x, so the case C2 makes free is the one that loses most without it. Every one of the 63 sites in the profile is monomorphic. A field or an array of the interface type still has no concrete type to specialise over. Record 0294 `examples/a-structural-cast-that-is-not-a-prefix` carries it, and `examples/a-structural-cast-that-is-a-prefix` the case that does line up — the pair is what shows the prefix is the deciding property. |
| ✅ | a **class constructed only through the napi boundary runs its field initialisers** | it ran none: the wrapper calls `nts_construct_X()` and then the compiled constructor, and the initialisers were emitted at the `new` *site*, which such a class has nowhere. `class Published { counter = 41 }` published to JS had `counter` at **0**, and for a class nothing constructs internally the literal `41` appeared nowhere in the emitted program. Fixed by the same move as the row in §5 and with no separate function: the wrapper already calls the constructor, so putting a class's initialisers *in* its constructor is what makes the wrapper run them — the node profile's own suites are what exercise it: a class reached only through a wrapper is every exported class in `runtime/node`, and `tooling/conformance/prize.mjs` runs those suites against the compiled `.node` |
| ✗ | an **object crossing the napi boundary** — a parameter or return of `number \| object`, and `unknown` given an object | one mechanism, seen at a parameter and at a return, and diagnosed hours apart as two things. An erasing union **declines outright**: no wrapper, nothing published, deliberately — a wrapper that accepts everything and throws for everything is worse than absence, which `buffer.isUtf8` demonstrated. `unknown` **publishes and throws**: `nts_from_napi_value` handles `undefined`, `null`, booleans, numbers and strings and its `default:` arm throws, so `isatty(0)` answers and `isatty({})` throws where node answers `false` for anything. What it needs is a payload a compiled function can hold, and a `napi_value` is only valid for its call — so it is a **lifetime** question in the runtime's reference counting rather than a marshalling one in the wrapper. It is behind `dns.promises` (the return half) and `tty`'s compiled lane (the parameter half), and 97 of 457 declined exports are boundary-shaped. `blockers/an-object-at-the-boundary` |
| ✅ | `Map`/`Set` `forEach` | the `for...of` table walk with the callback's body inlined — `walk_cursor`, `walk_condition`, `read_element`, `Step::Walk`. `(value, key)`, which is the reverse of the order the table stores them in; a `Set` passes its element twice — `examples/map-and-set`, `scores.forEach` on a `Map` and `seen.forEach` on a `Set` |
| ✗ | the **table** parameter of a `Map`/`Set` `forEach` | the third the callback may take. Handing the receiver to the body lets it be stored where the loop cannot see, and mutating a table during a walk changes what the cursor is walking |
| ✅ | a default in a destructuring pattern (`{ a = 1 }`) — `examples/destructuring`, `{ name = "xy" }` |
| ✅ | `yield*` | a walk with a `yield` where the body would be, which is what the language says it is — and built that way the stated obstacle disappears. The inner cursor is live across the `yield`, so `hir::suspend`'s spilling puts it in the frame with everything else that survives a suspension; nothing arranges it. The depth follows: each `yield*` is its own loop with its own spilled cursor, so three levels are three cursors, exactly as two nested `for...of` loops in one generator already were. Every shape `for...of` knows arrives for nothing — an array, a string by code point, a table, a user type with `[Symbol.iterator]`, and a generator **including one that arrived as a parameter**, which is the commonest spelling in the corpus and is why this had to come after the representation. The *value* of a `yield*` is the inner iterator's `TReturn` and stays refused, by its own name. `examples/a-yield-star`, 232 cases |
| ✗ | the **value** of a `yield` (`const v = yield x`) | what the caller passed to `next(v)`, and a `for...of` passes nothing. Answering `undefined` to a program expecting a two-way conversation runs and produces numbers, which is why this is refused. **Ranked rather than assumed: zero of the 136 lines mentioning `yield` in `runtime/node` read one's value**, so this is a spec gap with no corpus demand — the generator work worth doing first is `async function*`, which the refusal census puts at 13 distinct things — **done 2026-09-12**, two rows down |
| ✅ | a generator walked anywhere but where it was made | `Generator<T, …>` is represented as the prefix every frame already begins with -- `state` and `yielded`, at 24 and 28 in the emitted C -- so a concrete frame *is* a structural prefix of it and a signature can name one. The checker's own id for `Generator<number>` is the class, rather than a synthetic band beside it: the checker has already decided that two files writing `Generator<number>` mean one type. Each frame records it as `Layout.base` and overrides the resumption it declares, so a walk that can see which body to resume still emits a **direct call** and one that cannot loads `descriptor->methods[slot]`. That split is not an optimisation applied afterwards: on ART there is no inline cache and no free monomorphic case -- 1.88x to 2.06x a field read against 1.02x on HotSpot -- and this call is on the hot path of every element of every walk. The abstract generator declares the resumption and defines nothing, which is record 0090's `abstract_declaration` with its signature taken from an implementer. `examples/a-generator-walked-elsewhere`, **232 cases across eight functions, C, LLVM and the JVM**. Two arms were added on 2026-09-12 for a case the first pass got wrong by looking right: a generator handed back by a function that is **not one**, walked at the call rather than through a parameter. The walk took the resumption's name from the call that produced the frame, so `relay(n)` — a direct call to a plain function — named `relay__resume`, which nothing declares. `drain(chosen(n))` never reached it, because there the frame arrives as a *parameter* and the dispatch runs; the two shapes differ only in whether a parameter stands between the call and the loop. The fix is that the call site records which of its calls actually *were* generators' — `OpKind::Call` says a call was direct and says nothing about what it called, and those are not the same question. It refused rather than mislinking, and the diagnostic named `relay__resume`, which is the only reason it was cheap to find |
| ✅ | `async function*` and `for await...of` **over one** | landed 2026-09-12, C, LLVM and the JVM. The two protocols do disagree about what a resumption is *for* — one settles a promise nobody is waiting in front of, the other answers a caller who is — and the resolution is that an async generator's resumption **answers nobody**: the consumer makes the promise for each step, puts it in the frame, runs the resumption and awaits it, and a `yield` settles it rather than returning. `done` rides that promise as a **number**, because `nts_promise_fulfill_number` and `nts_promise_number` already exist and a new runtime helper reds every backend that has not learned the name — with `bench-agree` having no allowance list, that is a landing blocked on another lane rather than a line of C. **The element rides nothing**: it stays in `yielded`, so an async walk allocates one promise per step and no `{ value, done }` object ever. `state` and `yielded` keep slots 0 and 1 — the prefix every frame shares with the abstract generator — so an async generator walked through a *parameter* dispatches on the same slot a synchronous one does, which is the commonest spelling in the corpus. Four refusals stood in the way and the cause moved at each; the third is the one worth keeping: `AsyncGenerator` was missing from the frontend's natively-represented list, beside `Generator` and a paragraph arguing the case in words that never said which of the two it was about, so `T` never arrived and every `async function*` stopped with a message about its element type. `examples/an-async-generator`, **261 cases across nine exports**. Corpus, measured against the commit before it: `an async generator` and `a \`for await\` loop` together go **96 → 0** — zlib 31, fs 34, stream 30, timers 1 — while total `NTS1001` roots across those modules fall by **50**, and the gap is the honest half: forty-six of them moved to whatever stood behind them rather than clearing. The new refusal beside it fires **0 times** in the whole corpus |
| ✗ | `for await...of` over a **synchronous** sequence | legal JavaScript, and it is not `for...of`: it awaits **each element**, so the loop yields to the microtask queue once per iteration even when nothing in it is a promise. **The obvious fixture cannot see this** — the elements, their order and the sum are all identical, and only *when other work runs* differs. Recording the order instead, against a second async function queued before the loop: `129` here against node's `912`, node suspending before even the first element. Two controls in the same file agreed, which is what makes it a statement about `for await` rather than about the harness. Refused by name rather than approximated: the elements would be right and the interleaving wrong. `blockers/a-for-await-over-a-synchronous-sequence` |
| ✗ | `for await...of` over an **`AsyncIterable`** | the protocol object rather than the frame, and the same shape as its synchronous twin: `[Symbol.asyncIterator]()` handing back something with a `next()` returning `Promise<IteratorResult<T>>`. `IteratorResult` is a union whose two arms lay their fields out differently, which was read as the refusal census's **number one row** — 57 distinct things across all 23 modules. **That reading was wrong and the row has since been split**: most of it is intersections rather than unions, and the union-shaped remainder is 12 things across five modules. `IteratorResult` is genuinely one of them and is not backed by the traffic that number implied, so this row wants building on its own merits rather than on a borrowed rank. `blockers/for-await-loop`, whose message moved from `a \`for await\` loop` to `a parameter of unrepresentable type (\`AsyncIterable\`)` when the loop form landed **Measured again 2026-09-13, and the row is two causes rather than one.** A parameter typed `AsyncIterable<number>` never reaches the walk: lib.d.ts's `AsyncIterable` has no representation, so the parameter is refused before its body is read, which is the message this row already records. A parameter typed by a *user-named* interface declaring only `[Symbol.asyncIterator](): AsyncIterator<number>` is representable, being an ordinary object type, and draws a different refusal -- ``a `for...of` over `NumberStream` ``. The second is the corpus shape: `zlib`'s `transform(source: AsyncByteStream, …)` and `stream`'s operators take their source as a parameter, and of the **38** `for await` sites in `runtime/node` the ones not over a call are over a value whose declared type is an interface. It also makes this an async counterpart to `Walk::Protocol` rather than a new mechanism, the synchronous half being row 2007 and green. The `IteratorResult` prerequisite above binds only where a hand-written `next()` returns `Promise<IteratorResult<T>>`; one returning a concrete `{ value, done }` never reaches it. **And the position is the test**: `const s: AsyncIterable<number> = ticks(3)` compiles today, because the initialiser still carries the concrete generator type for the walk to read, so a probe that annotates a local measures nothing about the declared type. This row read green for an afternoon on exactly that -- two arms of one probe differing in position as well as in annotation. `blockers/an-async-walk-over-a-declared-interface` |
| ✗ | iterator helpers (`map`, `filter`, `take`, …) | **empty cell, probed 2026-09-13 rather than left as a title.** Demand is zero and that is a measurement: `.take(`, `.drop(`, `.toArray(`, `Iterator.from` and `.flatMap(` across 458 files of `runtime/node`, `examples` and `benches` return **0**, with a control that fires on four of the five patterns so a zero is distinguishable from a broken one. And it is not silently wrong, which is the thing an empty cell cannot tell you: `counted(n).map(x => x * 2)` refuses as ``a method `map` with no declaration in the hierarchy``, `take` likewise, and the control — the same generator walked by `for...of` — compiles. So the row is empty because nothing reaches it, and the refusal in front of it names the right cause. The neighbouring empty cell two sections down was not this lucky |

The mutation row is the one worth keeping honest about. A walk's whole state is
an entry index, so a rehash that compacted the table's holes would move entries
out from under it. Growth therefore keeps every entry where it is, which costs a
hole not being reclaimed until `clear` — the fix, when that matters, is the list
of live iterators V8 keeps.

## 11. Evaluation order and completions

The obligations most likely to be silently wrong in a compiler, because
nothing fails loudly when they are.

| | | |
|---|---|---|
| ✅ | left-to-right operand evaluation, callee before arguments — `examples/a-call-with-an-explicit-receiver` |
| ✅ | short-circuit `&&`, `\|\|`, `?:` — `examples/erased-truthiness` |
| ✅ | an assignment target evaluated **once** — `xs[next()] += 1` calls `next` once, which is what `place_of` exists for — **no example writes `xs[next()] += 1`**, so the evaluate-once claim rests on the first clause of ✅ alone |
| ✅ | normal, `return`, `break`, `continue` and `throw` completions — `examples/control`, which carries `continue`, `break` and `return` in one walk |
| ✅ | module evaluation order, and the temporal dead zone as an error — `examples/module-evaluation` and `examples/module-order` |
| ✅ | abrupt completion through `finally`, including one that replaces the completion leaving it — `examples/exceptions` and `examples/async-finally` |
| ✗ | iterator closing on an abrupt completion | **the same fact as the `.return()` row in §10, and the argument lives there rather than being restated here.** Found 2026-09-13 while working the queue: one fact had two rows in two sections, and the one in this section was an **empty cell** — which is how two derivations of one fact come to disagree without anybody choosing to disagree. Kept rather than deleted, because a `for...of` left by `break` is a completion and the row belongs to this section too; cross-referenced rather than duplicated, because only one of the two can be the place the reasoning is checked. It is the second empty cell found in this table in two days and the row directly below it was the first — that one, probed rather than read, turned out to hold a wrong answer that runs |
| ◐ | conversion side effects (`valueOf`, `toString`) in operand position | **this row was empty, and probing it found a wrong answer that ran.** Most of the family is rejected by TypeScript before the compiler sees it — `o + 1` is TS2365, `"1" == 1` is TS2367 — and the two that typecheck, `` `${o}` `` and `Number(o)`, were already refused by name. **`a > b` between two objects is not a type error**, so it is the one shape of this family a checking program can write, and it emitted `gt %1, %7` on two `object.new` pointers: `class Celsius { valueOf() { return this.degrees } }` answered `a > b` **true for every input**, disagreeing with node on 29 of 29 cases. Refused by name as of 2026-09-13. So the family read as unreachable precisely because its one reachable member was the one nobody had written down. Closing it is `OrdinaryToPrimitive` with hint `number` — `valueOf`, then `toString`, then `TypeError` — a dispatch on members this compiler does put on the descriptor, so it is reachable machinery wanting an ordering rather than missing machinery. `blockers/a-relational-comparison-between-objects` holds it with three controls: numbers, strings, and the same comparison written through the member it would have called. Zero corpus demand. **Answered 2026-09-13 for the one reachable member.** `a > b` between two objects now calls `valueOf` — so the side effect happens, in the specification's order, and `examples/a-comparison-through-valueof` compares the result rather than the address. The rest of the family is unchanged and unreachable for the reasons above: `o + 1` is TS2365, `"1" == 1` is TS2367, and `` `${o}` `` and `Number(o)` are refused by name. So this row is now one reachable member answered and four unreachable ones, which is a different thing from an empty cell. **Re-measured 2026-09-14: the marker was wrong, the prose was right.** The two that typecheck are still refused, confirmed by running them rather than by reading this cell — `` `${o}` `` gives NTS1001 `a conversion to string from \`Celsius\``, and `Number(o)` gives NTS1001 `a conversion to number from this type`. Both probes **exit 0**: `emit-c` compiles what it can and refuses the rest without a non-zero status, so the exit code is not the signal here and the diagnostic is. One member answered, two refused, two rejected by TypeScript is ◐. This cell also **had a fourth column and the table has three**, so everything from “Answered” onward rendered as nothing — the same defect as the ten headers fixed on 2026-09-13, one row instead of a header.
| ∅ | getter, setter and `Proxy` side effects in operand position — §13 |

## 12. The runtime

`runtime/c`, about 3,300 lines and 130 entry points, provider-swappable.

| | | |
|---|---|---|
| ✅ | allocation; frame placement for what does not escape — `examples/native-fd` and `examples/native-poll` place native locals in a frame; **no example exercises managed frame placement on its own** |
| ✅ | reference counting, and a cycle collector over one traversal `examples/cycles` carries the half reference counting cannot reclaim, and `examples/borrowed-traversal` the shapes it gets wrong together with a check that can fail. |
| ✅ | strings, arrays, objects, tagged values (`NtsValue`) — `examples/erased-truthiness` and `examples/object-literal-through-a-union` for tagged values |
| ✅ | promises, microtasks, the tick queue — `examples/promise-constructor` |
| ✅ | timers: `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval` `examples/timers` carries all four, `clearTimeout` included. **`clearTimeout` added 2026-09-14**: the row listed three of the four and the example it now cites has carried all four throughout — five uses of `clearTimeout`, one of them cancelling a live timer. A row can understate its own subject and read as complete, and citing the example is what surfaced it. |
| ✅ | host loop, task posting, thread-ownership assertions — `examples/interop/native-callback` asserts `nts_is_owner_thread` from a foreign thread; **no example posts a task to a host loop** |
| ✅ | a hash table — open addressing, linear probing, tombstones, power-of-two slots; `Map` and `Set` are built on it, and `Object`'s enumeration statics turned out not to need one — `examples/string-keyed-table` and `examples/map-and-set` |
| ✗ | a regular-expression engine |
| ◐ | **a time value** — `nts_date_new`, `nts_date_value` and the `TimeClip` normalisation, three entry points and a `double`. No **clock** and no **calendar**: a wall clock is a capability this runtime does not have, and the field extraction that would need one is §2's `Date` rows. The JVM runtime carries the same three, and `examples/dates` agrees with node on 174 cases through it. This row read ✗ while `nts_time_clip` was in `runtime/c` — the second false row found in this file today, and found by looking rather than by anything that runs |
| ✗ | **a call-stack depth limit.** Unbounded recursion is `SIGSEGV` here where node throws a `RangeError` | **priced 2026-09-12, and it is affordable.** Two forms, measured against the emitted `fib__whole` copied verbatim so the arms differ in one thing, min of ten runs: a **depth counter** (increment, compare, decrement) costs **1.96x** and a **stack-pointer compare** costs **1.33x** — on a body that does *nothing*, which is the worst case there is. Put **eight floating-point operations** in the body and both read **1.00x**; at thirty-two, the same. The check is still there — 57 instructions against 40, with the global still referenced, verified in the assembly rather than assumed — and the CPU issues it alongside arithmetic it does not depend on. So the premise that a per-call check is a cost this project cannot pay holds only where the call does nothing at all. The stack-pointer form is the one to build: one global reference against the counter's five, and no memory write. **A second cost, found 2026-09-12 and not priced by that record: what the check does when it fires.** node's `RangeError` is *catchable*, and a throw raised inside a call is refused here — see the `try`/`catch` row, where a `throw` lowers to a jump to the enclosing handler **block** and a callee has no edge back to its caller's handler. A depth check is by construction inside a call, so it cannot reach a `catch` in the frame that started the recursion. What is available today is a **controlled abort** naming the depth, which is strictly better than `SIGSEGV` — a defined failure instead of undefined behaviour — and is still not what node does. So this row is two features with one name: the check is affordable and buildable now, and *agreeing with node about it* waits on cross-call exceptions, which the `try`/`catch` row says is unwinding the reference counts rather than the jump. Pricing the instruction cost answered the question the queue asked and not the one that decides the row |
| ✗ | shared memory and an agent model — the threading primitives above are the runtime's own task posting, and `Atomics` needs more than they provide |
| ∅ | a property map, a prototype chain, a metaobject protocol — §13 |

## 13. What this compiler is not

Every row here is refused, and none of them is a backlog item. They are one
decision made once, and it is the decision the whole compiler is built on.

### What that buys a test suite, which is not obvious

A row here is **assertable**. A test may pin a divergence that this section
declares, and may not pin one the implementation merely happens to produce --
and the difference between the two is exactly whether it is written down as
intended.

The node lane found the rule by having both cases in one survey.
`Buffer.from({ valueOf: () => "zz" })` coerces on node and throws here, and so
does the `Symbol.toPrimitive` form: both are this section being applied, so both
are asserted. `cpSync` rejecting a `Buffer` path is a defect nobody chose, so
asserting it would pin a bug -- a test that **passes here and fails against
node**, which is backwards, and which would then have to be deleted by whoever
fixed it.

The pinned rows also carry a notification: if this section ever admits
`ToPrimitive`, those two tests fail and say so. That is the right way round. A
suite that asserts declared decisions gets louder when a decision changes; a
suite that asserts behaviour gets quieter when a bug is fixed.

### And a row here can reach the instrument doing the asserting

The sharpest consequence found so far is not in a module. Node's
`deepStrictEqual` compares **prototypes**, and a comparator in a language with
no prototype chain cannot:

    Buffer.from([1])       vs  new Uint8Array([1])   node: differ   here: equal
    Object.create(null)    vs  {}                    node: differ   here: equal
    new (class { x = 1 })()  vs  { x: 1 }            node: differ   here: equal

Those three are this section applied, so they are assertable rows. What is not
obvious is what they imply about **every other test that uses the comparator**:
an assertion meaning "the right class came back" actually means "the right
fields came back". A test that a call returns a `Stats` rather than an object
literal with the same fields does not check that.

It does not invalidate a suite — field values are still compared exactly, and
most assertions are genuinely about values. But it is a limit to know *before*
relying on it, and the workaround has to be named where the limit is:
`instanceof` does work, so a test whose point is object identity uses that.

### The metaobject protocol

An object in this compiler is a flat C struct: a header of
`descriptor + refcount + flags + length`, then fields at fixed offsets. The
descriptor carries the size, which offsets hold references, and a method table.
**There is no prototype pointer and no property map.**

So the following are not unimplemented — they are incompatible with that
representation, and implementing them means giving it up:

| | why |
|---|---|
| `Proxy`, `Reflect` | every trap is a property operation dispatched at run time |
| property descriptors | `[[Value]]`/`[[Writable]]`/`[[Enumerable]]`/`[[Configurable]]` per property, on an object with no per-property storage |
| `Object.defineProperty`, `freeze`, `seal`, `preventExtensions` | the same |
| `getPrototypeOf`, `setPrototypeOf`, `__proto__` | there is no chain to read or rewrite |
| exotic object kinds, the intrinsic graph, realms | an engine's object model; a compiled program has one static layout per type |
| `Symbol.species`, `Symbol.hasInstance`, `Symbol.toPrimitive`, `Symbol.unscopables` | hooks that redirect built-in operations at run time |
| `Function.prototype.toString`, observable `.name`/`.length` | a function here is a C function, not an object with properties |
| `Function("source")`, `eval` | a compiler is not in the program |

**TypeScript is what earns the right to omit them.** In a typed program the
dynamic property surface is largely unreachable: `defineProperty`, descriptor
manipulation and prototype mutation are not things typed code does, and where
it does them TypeScript types the result `any` — which is refused, deliberately
and separately.

This is not "a subset of JavaScript". It is the observation that a *typed*
program does not need the machinery an untyped one is compiled against.

### Free by construction

Excluded by the source language rather than by choice — a TypeScript module is
always strict, so none of this can reach the compiler:

`with`, sloppy mode, `arguments`, legacy octal, Annex B, `escape`/`unescape`,
`String.prototype.substr` and the HTML-wrapper methods, `Date.prototype.getYear`,
`RegExp.prototype.compile`, `Object.prototype.__defineGetter__` and friends.

### An out-of-bounds read is a refusal here and `undefined` on a host

`TABLE[code]` where `TABLE` has 256 entries and `code` is `0xD800` **aborts**:

    index 55296 is outside [0, 256)

Node answers `undefined`. That is the array model doing what §13 says it does —
an array is storage rather than a property map, so there is no slot to read and
nothing for `undefined` to come out of — and the differential reports it as the
divergence it is: "an index its `!` promised was in range and was not; node
answers `undefined` there".

It is here because of **how it hides**, which is a hazard for every line of
shared TypeScript rather than a fact about arrays. A table lookup written as
"read past the end and test the result for `undefined`" is an ordinary host
idiom, it passes every host test, and it is a hard abort the moment the same
source is compiled. The `web-platform` lane found it by a benchmark aborting —
its first `unicodeEscape` table read past its end for exactly one input, the
one that reaches the function from above the table — and every host test of that
same code passed.

So a lane that runs its source on a host and calls that coverage has not
checked this, and cannot. The instrument that sees it is the differential, or a
compiled benchmark with a checksum; the ordinary suite is silent, and silent
here reads exactly like correct.

### Reading a member by a runtime key, measured 2026-09-15

The node lane asked whether `expected[key]` can be given a representation, so
that `assert.throws` stops refusing a program node runs. Measured before
answering, and the measurement splits the question in two.

**The site they asked about needs the metaobject protocol.**
`readErrorField(value: object, key: string)` takes TypeScript's `object`, which
represents as an **erased** value — a tag and a payload. Reading a named member
off one means asking the runtime "which offset is `key` on whatever this
actually is", and `NtsDescriptor` carries `kind`, `size`, a reference-offset
table for the collector and a method table. **No field names.** Adding them is a
representation change: a name table per object type, and with an erased receiver
the compiler cannot bound which types reach the site, so conservatively that is
every object type in the program.

**That half is worth 10 sites.** And on `assert` specifically the residual after
their twelve added names is **6 expectations of 4,182**, three of which are keys
a test invented in order to fail. It does not pay for itself.

**But the first count was 10 because I counted a message and not a cause.** One
cause wears several diagnostics here, and the siblings are much larger:

| sites | the refusal |
|---:|---|
| 299 | ``indexing `X`, which stands for `X` here, which is not an array`` — `this` on a class: `WritableStreamDefaultWriter` 224, `WritableStream` 56, `Timeout` 14 |
| 248 | ``indexing `X`, which is not an array`` — `ReadableStream` 168, `HighWaterMarkOptions` 32, `StreamLike` 18 |
| 14 | indexing a union of an object \| null |
| 10 | indexing an **object type** — the erased case above |
| 7 | indexing a union of a tuple \| undefined |

578 together, and **547 of them have a statically known receiver.** That is a
different and much smaller feature: where the type is known at the site, `o[k]`
is a switch over *that type's own* property names against the runtime key, which
needs no runtime name table and no representation change at all.

**And 578 sites are 31 distinct source locations.** Counted rather than assumed
— `http/src/outgoing.ts` 6, `web-platform/src/streams/writable.ts` 5,
`readable.ts` 4, `util/src/deep-equal.ts` 3. That is the twenty-fold
site-to-cause overstatement this file's census header warns about, confirmed on
a fresh case, and it is the number any decision should use.

So the answer to the lane is: **the erased read is deferred with a reason and a
count**; the static read is a real candidate at 31 distinct sites, unstarted, and
subject to the same caution as everything else in §15 — clearing a refusal
advances a chain and is not the same as publishing anything. Nobody should start
it on the strength of 578.

### Three roots, three zeros: read this before the queue below

**On this corpus, clearing a named refusal has never once published an export.**
Three roots were tested by removing the construct in a throwaway worktree and
diffing the export set — the node lane's method, and the only one that answers
"what does this buy" rather than "what does this clear":

| root | rank | refusal after removal | exports published |
|---|---|---|---:|
| `dictionary`'s union | top by *message count* | the pointer-cast root behind it | **0** |
| `asRequest` | #1 by exports-behind | `takes an object` | **0** |
| `toUnixTimestamp` | #6 by exports-behind | `asRequest`, `displayBytePath`, and the boundary | **0** |

`toUnixTimestamp` is the clearest of the three because the cause was the
cheapest — `Date.now` has no definition, so it is a missing builtin and not a
representation question. Removing it took the refusal 2 → 0 and the published
count 22 → 22, and routed **four of its five exports straight into the #1 and #2
roots**. The fifth is `toUnixTimestamp` itself, whose parameter is
`number | string | Date` — a union that erases, so it could not cross however
well it lowered.

**So exports-behind-a-root is not the payoff and the table below must not be
read as one.** The number behind a root is the number that moves to the *next*
root. Two of the three terminated at `takes an object`, from two unrelated
lowering questions, which is the boundary rather than the compiler.

Counted at the surface, 2026-09-15: of 506 declined exports, **431 name a
lowering refusal and 62 name a boundary one** (31 "exported as a value of type
`X`, which does not cross", 16 "takes an object", 6 "returns an object"). That
split is *also* a measurement of what is in front rather than of what is
terminal, which is this section's whole subject.

**And the three probes do not fix that, which corrects what this entry said an
hour ago.** It claimed they were evidence that the terminal distribution is more
boundary-weighted than the surface one. They are not, and the reason is
selection: all three roots were chosen *because they sat at the top of the
queue*, and a root is at the top precisely because many exports stand behind it
— which is the population with the most elaborate signatures, and therefore the
one most likely to hit the boundary. The sample is biased toward the answer it
gave, and a fourth top-root probe would inherit the bias rather than be a fourth
independent point.

What the three support is narrower and still worth having: **for the three
largest roots on this corpus, the exports behind them terminate at the
boundary** — enough to say the top of this queue is mis-ranked as a publishing
plan, and not enough to say where chains end in general.

Nor can this method answer it. Removal reveals the *next* blocker, never the
last, because the compiler reports one at a time — three probes bought two hops.
A real terminal distribution needs the removal iterated per export until each
one either publishes or reaches the boundary, which is forty-odd worktree runs
and not worth anybody's afternoon.

**What this does not say.** It is not an argument against fixing the refusals:
`asRequest` moving one link is real, and a compiler that refuses a call any
reader can pin is wrong whatever it publishes. It is an argument against
*counting exports* as the return on a lowering fix, and against any plan built
on this table's left-hand column. If published exports are the goal, the work is
at the N-API boundary — making an object cross — and not in lowering at all.

**A fourth instance of the rename hazard, from inside this measurement.** A set
difference over refused names reported `_toUnixTimestamp` as newly publishable.
It was not: the export is `export { toUnixTimestamp as _toUnixTimestamp }`, and
once the `Date.now` refusal went the name was reported *unaliased* with a
different reason. Newly-publishable and newly-blocked were the same export. What
caught it was the published count **not** moving — two numbers disagreeing, one
of them checkable. After `<obj6704>`, the brace scanner and `asRequest<[erased]x2>`,
this is the fourth today: a name that carries anything unstable will be read as
a change by any instrument that diffs names.

### The ceiling, read off what each module already publishes

The node lane proposed an instrument for the question the three zeros raise: an
export whose own signature cannot cross will never publish however well anything
lowers, so classifying every exported signature gives an upper bound with no
compiler run and no chain-following. It is the right question. It also turns out
to be answerable from numbers already on disk, without the instrument and
without the root-selection bias that spoiled the three probes.

**Published functions against declined exports, all 26 modules, 2026-09-15.**
Published counted as `napi_create_function` in the emitted `addon.c`, which
counts a namespace's own members as well as top-level exports — `path`'s 34 is
11 top-level plus two namespaces' worth. Classes are registered separately and
are not in the column. **The emitted file states all four numbers itself now**,
so this no longer has to be counted by hand: every `addon.c` ends with

    /* This module publishes 1 top-level function(s), 1 class(es) and 2
     * namespace(s), and declines 123 export(s). ... */

| module | published | declined | rate |
|---|---:|---:|---:|
| `punycode` | 7 | 0 | **100%** |
| `os` | 19 | 2 | 90% |
| `path` | 34 | 7 | 83% |
| `util` | 38 | 41 | 48% |
| `async_hooks` | 17 | 12 | 59% |
| `net` | 8 | 11 | 42% |
| `http` | 3 | 21 | 13% |
| `stream` | 5 | 74 | 6% |
| `fs` | 2 | 123 | **1.6%** |
| **total** | **162** | **506** | |

**The rate tracks the shape of the API and not the quality of the lowering.**
`punycode` and `path` are string-in, string-out, and publish nearly everything
they declare. `fs` is callbacks, options bags and `Stats`, and publishes two
functions out of a hundred and twenty-five. Nothing about `path` was lowered
better; its signatures cross and `fs`'s do not.

That is the ceiling argument with the whole corpus as its population rather than
three roots chosen for being large, and it agrees with the three zeros without
inheriting their bias. It does not give an exact bound — the unit here is a
module, not a signature, and "shape of the API" is read off which module a
function is in rather than measured per declaration. The lane's instrument would
give the exact number and is still worth building if anyone wants it. **The
direction is no longer in question.**

**What it means for this queue.** Every root below is a lowering refusal, and
the rate table says lowering refusals are not what bounds `fs` at 1.6%. Fixing
them is worth doing on its own terms and it is not a publishing plan. If
published exports are the goal, the work is making an object cross the N-API
boundary, which is a feature nobody has started.

**A method note, because the first version of this table was wrong.** The
published count was first taken by matching quoted names in `addon.c`, which
returned `atimeMs`, `birthtimeMs`, `blksize` — the **field descriptors of the
`Stats` class**, not exports at all, and gave `fs` 15 published with none of
them a function. The registration to count is `napi_create_function`. A regex
aimed at a file's *shape* found something with that shape and answered
confidently about the wrong thing, which is the day's fourth instrument error
and the third caught only by looking at the names it returned rather than the
count.

### Two candidates diagnosed to their blockers, 2026-09-16

Both were reached by breaking a *category* down until it named a construct — the
move that found `undefined | void`. Neither is started; each is recorded with
what actually stops it, because a rank without a diagnosis is what §15 already
records itself getting wrong.

#### Swept 2026-09-17: shapes the refusal census rates at zero

Five batteries of ten-line fixtures over ordinary language shapes, one shape per
probe. About forty shapes, and the point of recording it here is that **the
census could not see most of what it found**: a refusal is only emitted for code
the compiler *reached*, and every enclosing function in `runtime/node` that
would hit these stops earlier on something else. Two of the night's fixes —
destructuring elisions and `super` accessors — were **0 sites** in the
four-module census and are what any new program writes on its first day.

**Passing, and worth having written down so nobody re-probes them:** labelled
`break`, `do`/`while`, `switch` fallthrough, a comma in a `for` header,
getters and setters on a class, `static` blocks, spread into a call, optional
`catch` binding with `finally`, rest and default parameters, array
destructuring with a rest, nested destructuring, private methods and `#x in o`,
logical assignment, `**`, bigint literals, `for...of` over a string, tagged
templates, assertion functions, `satisfies`, `as const`, index signatures,
overloads, abstract classes, `Error` subclassing with `instanceof`,
`Array.from`, `readonly` array parameters, typed array read/write, `yield*`,
`using`, `const` type parameters, `String.raw`, `replaceAll`, shorthand
properties, `implements`, local *function* declarations including recursive
ones, IIFEs, and the comma operator.

**Still refused, each confirmed with a one-shape fixture:**

```text
  new.target                                     a meta property
  accessor v = 3                                 the `accessor` keyword
  [[1],[2]].flat()                               `flat` on an array of references
  Object.entries, JSON.stringify                 a global member with no definition here
```

None is a designed deferral, and none has a row of its own — recorded together
because **a missing row is worse than a ✗**: a ✗ has been looked at, and an
absence has not.

**Four lines left this list on 2026-09-17, and the way the last one left is the
part worth reading twice.** The row said *a method or accessor in an object
literal*. Re-probing each line rather than trusting it found that the accessor
passed at either scope and the method passed **inside a function** — so what
actually refused was a module-scope `const o = { twice() { … } }`, a construct
*in one position*, and the row as written sent a reader to build something that
already worked. Narrowing it was what made the next question askable, and the
answer was that nothing was missing at all: see below.

#### `static get` / `static set`, and `super` in a static member (fixed)

Two gaps that a sweep found and a census could not, because **neither refusal
named the construct the program contained**.

`A.base` where `base` is a `static get` was refused as ``base`, a static field
this compiler gave no storage`` — a sentence about storage, for a member that is
code. `A.base = v` reached the same wrong answer from the other side: with no
storage to write, the place fell through to lowering the *receiver*, and `A` is
a class, so ``A`, a class used as a value``.

**The function was there the whole time.** `func A.get base()` is lowered like
any other static member and `dce` drops it, because nothing calls it: a static
accessor is *read* as a property access, so it never took a call path. Only the
call was missing. `Place::Setter`'s receiver is an `Option` now, which is what
lets the write half be the same shape as every other accessor write —
`A.base += 3` needs the getter and the setter in one expression and gets both.

`super.make()` inside a `static make()` was refused as ``super` outside a
derived class``, inside a derived class. The lowering cleared the base when it
lowered a static member and said why:

> No receiver, so no `this` and no base to resolve `super` against. Reaching
> either inside a static method is a TypeScript error, so there is nothing to
> refuse here that the checker has not.

Half right: `this` is an error there and `super` is not. The two were cleared
together because they are cleared in the same place, and one sentence covered
both. Static dispatch has no slot and nothing to override, so the base's name is
the whole answer and the call is direct.

`examples/a-static-accessor` is 8 exports and `examples/super-in-a-static-method`
is 4, both agreeing with node on C, LLVM and the JVM, against 8 refusals each on
the pre-change binary. The second covers two levels and a class that declares
neither member, because a lowering resolving `super` to "the root of the chain"
would agree with node on the one-level case.

**An existing test caught the first version of the write path.** It looked for
any `set` accessor rather than a `static` one, so an *instance* setter took the
static path and was emitted as a direct call —
`an_overridden_accessor_is_dispatched` in `compiler/core/tests/member_names.rs`
failed on exactly the assertion it was written for. A check that does not test
the thing it is named after passes for every input that reaches it.

#### An object literal holding code, at module scope (fixed)

`const o = { twice() { … } }` outside a function was refused as **a method on an
object literal**, and the binding after it as *a module-scope variable whose
initializer is not constant*. The same literal inside a function lowered, ran,
and agreed with node.

**Nothing had to be built, and the guard's own comment said why it existed:**

> Code, rather than data this file happens not to use. Reported here because
> nothing downstream will: the methods of an object literal are not walked, so
> they are not lowered and not refused.

That was true when it was written and stopped being true when a literal's
members were walked. A module-scope binding whose initializer is not constant is
deferred to `module#init` and built there — which a literal with a *non-constant
field* has always done, `{ v: seed() }` compiling and running throughout — and a
literal holding a method is the same deferral carrying the same kind of value.
Deleting the guard is the whole change. An arrow, `{ twice: (n) => n * 2 }`, was
the second half of it and lowers too.

**A refusal whose reason has expired does not fail; it just keeps refusing.**
Nothing in the tree connects a guard to the sentence that justifies it, so the
only thing that finds one is re-probing a claim you already believe. This one
was found by reading the ledger's own list back against the compiler.

##### And behind it, a wrong answer with no diagnostic

Clearing it published a defect that predates it and is worth more than the
feature. Two object literals of the **identical shape** —

```ts
const a = { which(): number { return 1 } }
const b = { which(): number { return 2 } }
```

— produce one layout, correctly: a layout is a *representation*, and identical
shapes deliberately share one. The name a member was emitted under came from
that layout, so one `Type4#which` was defined, both call sites called it, and
`b.which()` returned **1**. On C, on LLVM and on the JVM, with no diagnostic
anywhere, on the shipping compiler, inside a function — nothing to do with
module scope.

`examples/a-method-on-an-object-literal` has covered "two literals declaring the
same member name" since it was written, and could not catch this: **its two
literals declare different fields**, so they are different types, different
layouts and different functions. The case it was written for was the name
collision; the case that was broken was the name *agreement*.

The fix is one sentence: a name for dispatch is not a representation. Every
anonymous object type that declares an implemented member now carries its own
`hierarchy.name`, which is the identity the checker already gave each literal
separately, and `class_name_for` reads the hierarchy before the layout. The
layouts still merge, because sharing storage was never the bug.

`examples/an-object-literal-at-module-scope` is 5 exports over methods, arrows,
both in one literal, an accessor beside a method, and two identical literals —
**11 refusals** on the pre-change binary. `a-method-on-an-object-literal` gained
`identicalShapeTwice`, which **disagrees with node on 28 cases** on that same
binary and agrees on all three backends now.

#### A class expression (fixed)

`const C = class { … }` lowered its **fields** and none of its members. Every
walk over the program read `CLASS_DECLARATION` and stopped there, so a class
expression's methods, accessors, constructor and statics were never entered —
and the refusal a call site got, ``a method `m` with no declaration in the
hierarchy``, names the symptom rather than the cause. The shape read as
supported right up to the first method.

`blockers/class-expression` has held this since 2026-09-08, with reach measured:
**5 occurrences in the `os` program and 34 in `fs`**. It is written rather than
avoided because the two are not interchangeable there — `internal/uv.ts` needs a
class that implements an interface while the *binding* carries a different name
from the class, so `err.constructor.name` reads `"SystemError"` without a second
name in the module's public surface. It is now a regression guard.

**One syntax kind and six places that decided what a class is.** `CLASS_EXPRESSION`
was not in `syntax.rs` at all; `declares_a_class` is the predicate now, and the
walks — the hierarchy, `implements`, generic copies, static initializers, the
member driver and the ancestor lookups — ask it instead of naming one kind.

Three things the missing name costs, each of which was a defect before it was a
design:

- **`instance_type_of`.** A class *declaration* node carries the type it
  declares; a class *expression* node carries the type of the expression, which
  is the **constructor**. Both are right. Every walk here wants the instance, so
  taking the node's type directly emitted `func Type8#m(this: managed<obj#2>)` —
  a method named for the instance whose receiver is the constructor, which has
  no fields, so ``this.v`` refused with ``v`, which `__class` does not declare``,
  a sentence about the source that is false.
- **`nominal_or_stand_in`.** The checker calls an anonymous class's symbol
  `__class`, and *every* anonymous class in a program shares it — the `__object`
  collision one construct over. One function now answers what a type is called,
  and a layout, a member's emitted name and a call site's callee all ask it.
- **A `hierarchy.name` for an anonymous class.** This one was a *silently wrong
  answer*, which is worth stating plainly. A layout is a representation and
  identical shapes deliberately share one, so the name a call site falls back to
  when the hierarchy has none is the **merged** layout's. For a named class that
  fallback is never reached. For two anonymous ones it named both alike, and
  `new Second().which()` called `First`'s function: the fixture agreed with node
  on 264 of 319 cases, and every disagreement was off by exactly the difference
  between the two bodies.

`examples/a-class-expression` is **319 cases across 11 exports** agreeing with
node on C, LLVM and the JVM, against **22 refusals** on the pre-change binary.
It includes two anonymous classes declaring the same member name — the case a
shared layout answers alike — returning different values rather than the same
one, which is what turns a merge from a count into a wrong number.

**A `static` on an *anonymous* class is still refused**, and not for want of a
case. A static is addressed by name from source — the program writes `C.s`, and
`C` is the variable, not anything the class knows about itself — so the stand-in
that works for a method, which nothing outside the program reads, would be a
global no source can be traced back to. Naming the class answers it, which is
what the corpus already does. `blockers/a-static-on-an-anonymous-class` holds
it, and `blockers/class-as-value` holds `constructor.name`, the other half of
what `internal/uv.ts` is waiting on.

#### A class declared inside a function (fixed)

`function f() { class L { … } … }` was refused as `a class declaration is not
supported by this lowering yet` — the generic fallthrough for a statement kind
nothing handled — and the whole enclosing function went with it.

Nothing had to be built. The driver walks **every** `CLASS_DECLARATION` node
wherever it sits, so the layout and the members were already lowered, and
`new L()` resolves through the checker's type rather than through a binding. The
statement declares no value, which is the same reason `bind_nested_function`
answers `Ok(())` for a function nothing captures — the two share an arm now.

`examples/a-class-declared-inside-a-function` is 116 cases across four exports on
all three backends, four refusals on the pre-change binary. `twoInOneFunction`
declares two and they answer differently, so a layout shared between them would
show in the value rather than only in a count.

**A member that reads an enclosing local is not answered and should not be.** It
refuses inside the method, naming the name — a class that closes over its scope
needs the capture machinery an arrow has, and a class has nowhere to put the
captures: its instances are the user's, one per `new`, while a closure's
environment is one per *creation of the closure*.
`blockers/a-class-capturing-its-enclosing-scope` holds it.

#### `catch (e) { … ; throw e; }` (fixed)

Rethrowing the caught value was refused, by the **backend**:

```text
NTS2008 a value of type Erased cannot be erased yet; a reference payload needs
retain and release that switch on the tag
```

A true sentence about a conversion nobody was asking for. A caught value is
already erased — it carries its own tag — so erasing it is the identity, and
`erased_tag` having no tag for "already erased" made it read as the
unimplemented reference case.

**Five sites in lowering already wrote that identity out as a `match`, and
`throw` was the sixth.** It is `FuncBuilder::erased` now, said once.

`examples/a-rethrow-of-a-caught-value` is 116 cases across four exports on all
three backends, two refusals on the pre-change binary. `selective` is the arm the
idiom exists for — recognise a kind, rethrow the rest, and let an outer handler
tell them apart, so a rethrow that lost the value's identity answers 30 where
node answers 20. `freshInstead` is the control that says this was about the
*caught* value.

NTS2008 across `stream`, `fs` and `http`: 1/2/1 to 0.

**A rethrow that leaves the function still refuses**, and for an unrelated
reason: an exception does not cross a call boundary here — `a call inside a
`try`, whose `throw` would not reach this handler` — which is a runtime design
rather than a lowering gap.

#### `super.x` on an accessor (fixed)

`super.m()` was answered by `lower_super` from the call path. `super.x` where
`x` is a **getter or a setter** was not: an accessor is a method on the base,
reached by name, and the receiver was being lowered as an ordinary expression —
`super` has no value of its own, so the refusal was the generic `a super keyword
is not supported by this lowering yet`, a sentence about the token.

`Callee::Direct` and never virtual, which is what `super` means: a virtual
dispatch finds the override, and for
`override get scaled() { return super.scaled + 100 }` the override is the
function asking.

One walk answers both directions. A predicate beside an emitter is two chances
to disagree about which class a `super` resolves to, so `super_accessor` returns
the receiver and the callee together and both sites take the pair or neither —
which a compound assignment (`super.x += 1`, a read and a write) needs anyway.

`examples/super-on-an-accessor` is 174 cases across six exports on all three
backends, nine refusals on the pre-change binary. `twoDeep` is the arm that
could only pass under a direct call: it chains two overrides, so a virtual
`super` never reaches the base at all and recurses until the stack runs out.

**`super.field` is not a gap**: TypeScript rejects it, `TS2855 Class field 'k'
defined by the parent class is not accessible in the child class via super`. A
probe of mine reported it compiling, which it had not — the probe counted `NTS`
refusals and the program had never typechecked. So the shapes `super` reaches
are a method, a getter and a setter.

#### `{}` — a type that erases and a value that does not (fixed)

An empty object literal was refused as `an object literal that is not an
object`, which is a true sentence about the *type* and the wrong one about the
value.

`{}` as a type is every value except `null` and `undefined` — a number is
assignable to it — so `representation_within` gives it `Erased`, and its comment
says why: representing it as a layout made `const x: {} = n` fail with a number
where an object was wanted, the checker being right and the representation
disagreeing. **That rule is correct and is untouched.**

The literal is a different question. `{}` written down is an object with no
fields, and the slot it goes into may well be erased — so it is now built as the
object it is and erased afterwards, which is exactly the two steps the
union-member arm beside it already took.

```text
  distinct NTS1001, against the gated b701ba20
  stream  948 -> 939    fs  1353 -> 1339    http  1150 -> 1136    net  842 -> 828
```

`examples/an-empty-object-literal` is 203 cases across seven exports agreeing
with node on all three backends, six refusals on the pre-change binary. Two arms
carry the weight: `distinct` holds that `{} === {}` is **false**, which a
representation folding both to one constant would get wrong and which is what
makes `identity` mean anything; and `numberInAnEmptySlot` is the control for the
type rule this change must not break.

`options = {}` is node's sentinel for "no options were passed" and sits under
`net.createServer` at 91 of 148 failing files and `http.createServer` at 241 of
405 — a number from the node lane's axis rather than from refusals, so it is a
statement about reach rather than about what this alone publishes.

#### The iteration family is 255 sites behind two *designed* decisions

`Iterable`, `AsyncIterable`, `Iterator`, `AsyncIterator`, `IterableIterator` and
`AsyncIterableIterator` name **255 distinct sites** between them — the largest
single cause in the tree by a wide margin, ahead of `SharedArrayBuffer`'s 94 and
`WeakRef`'s 66. Every one of them reaches `IteratorResult<T, TReturn>` through
`next()`, so the family has one root.

**What the root is.** `IteratorResult` is
`IteratorYieldResult<T> | IteratorReturnResult<TReturn>`, and both arms were
unrepresentable *because they are library types*: `decompose.rs`'s `is_carried`
list has one entry, `PromiseWithResolvers`. An identical hand-written
`{ done, value }` pair represents today, which is what says the shape was never
the problem. Adding the two arms to that list was tried and measured: **2 to 4
distinct sites per module**, because everything downstream stops immediately on
one of the two things below. Reverted rather than committed — a name-list entry
that clears nothing is a claim the list does not support.

**Blocker one: `any`, and it is not a gap.** `IteratorResult<T>` defaults
`TReturn` to `any`, so the return arm is `value: any`. `docs/any-unknown.md` is
the contract: *"`any` is not a Native TypeScript runtime type … no `any` type
may reach HIR or MIR … there is no fallback to a universal `any` value."*
Representing it as `Erased` — the obvious one-line move, and exactly what
`unknown` does — would violate that in writing. What the document specifies
instead is a `NeedsRepresentation` analysis over evidence and requirements, with
declaration provenance retained, and that is a design to build rather than
approximate.

Measured while finding this: `any` is refused in **every** position — parameter,
property, return — while `unknown` is representable in all three. So the gap is
the whole of `any`, not a corner of it.

**Blocker two: the arms disagree about `done`, and it is the optional modifier.**

```text
  interface IteratorYieldResult<T>   { done?: false; value: T; }
  interface IteratorReturnResult<R>  { done: true;   value: R; }
```

`shared_field` reads a member from a union only where every arm places it
identically as a **prefix** — same name, index and representation. Reproduced
one variable at a time on hand-written arms:

```text
  done: false / done: true, both required   compiles
  value types differing, done agreeing      compiles
  one arm `done?: boolean`                  refused
```

`done?: false` is `false | undefined`, and a bool has no room for an absence, so
it represents as `Erased` while `done: true` is `bool`. The arms genuinely
differ. This is [[0291]]'s territory — an optional property having a third state
— rather than anything about iteration.

**So the honest statement of this row is: 255 sites, one root, and the root is
two design decisions rather than a missing feature.** Neither is a thing to
sneak past; both are worth building properly. Recorded here so the next attempt
starts from that rather than from the size of the number.

#### An object literal supplying an optional property — 87 sites, one modifier (fixed)

`a X where a Y is wanted, which is a pointer cast between two structs that do
not agree about where their shared fields are` is the second-largest refusal by
distinct site: **87**, and the overwhelming majority read `an anonymous type`
on one side. That is the options-object idiom — `readdir(path, { withFileTypes:
true })` — and it is one rule.

**It refuses exactly when the literal supplies a value for a `?` property.**
Measured, one variable at a time, single call, single file:

```text
  interface has          literal supplies              refusals
  ---------------------  ----------------------------  --------
  depth: number          { depth: n }                     0
  all three required     all three                        0
  depth, encoding?       { depth: n }                     0   omits it
  depth?                 { }                              0   omits it
  depth?                 { depth: n }                     1
  depth?, encoding?      { depth: n }                     1
  depth, encoding?       { depth: n, encoding: "u" }      1
```

**And it is the `?`, not the representation.** The last two rows of the
discriminator:

```text
  encoding?: string                { encoding: "u" }     1 refusal
  encoding?: string                { encoding: undefined } 0
  encoding: string | undefined     { encoding: "u" }     0 refusals
```

`encoding?: string` and `encoding: string | undefined` have the **same**
representation and differ only in the modifier, and only the first refuses. So
this is not erasure, not field count, and not offset arithmetic in any sense a
reader would guess from the message — it is `PropertyRecord::optional`.

**The mechanism, and it is this file's recurring one.** `count(o: Options)` is
not lowered as taking `Options`. It is lowered as `count@0obj8(o:
managed<obj#8>)` — a **structural copy**, keyed by `structural_instantiations`
on the *checker's* type of the argument expression. Meanwhile
`lower_object_literal` builds the literal at its **contextual** type, which is
the parameter's declared one. Two derivations of "what shape is this argument",
and they agree until the literal supplies an optional property — at which point
the checker's type for the literal marks that property **not** optional while
the declaration marks it optional, and the two layouts differ.

**Fixed 2026-09-16, and the declared type is the side that wins.** A literal is
built to order and has no prior layout to cast *from*, which is the whole reason
the structural copy exists; so `structural_instantiations` skips an argument
that is an object literal and `lower_object_literal`'s contextual type is the
single answer. One condition. It also produces fewer copies — every call passing
an `Options`-shaped literal now shares the declaration.

```text
  distinct `pointer cast between two structs` refusals
  stream  47 -> 40     fs  77 -> 61     http  57 -> 50
```

`examples/an-object-literal-with-optional-properties` is 145 cases across five
exports agreeing with node, refused six times by the pre-change binary. Its arms
answer 0, 10, 100 and 110 apart from the value they carry, so a literal built at
the wrong layout reads a neighbouring field rather than agreeing by accident.
`addons.sh` 24 of 24, 0 regressed.

What remains under this message is the case the copy is genuinely for: an
argument that is a *value* of one object type where another is wanted, with no
literal at the call to build differently.

#### The largest remaining message is not a cause — 177 sites, two types

`a property X of unrepresentable type (a union of …)` is the biggest single
refusal left by distinct site: **177** across `stream`, `fs`, `http`, `net`,
`zlib` and `util`, against 83 for the next one. Read as a cause it says the
compiler cannot represent unions, and the work it suggests is union
representation.

It is not that. Grouping the 177 by *which* union:

```text
   85  `AsyncIterableIterator` | undefined
   58  `ArrayBufferView` | `ArrayBuffer` | `SharedArrayBuffer` | undefined
   15  `Iterable` | an object | undefined
    5  `WeakRef` | null
    4  `ReadableStream` | null
   10  eight others, one to three each
```

and then asking which *member* is the blocker, by building the union without it:

```text
  ArrayBuffer | undefined                        0 refusals
  ArrayBufferView | undefined                    0 refusals
  ArrayBufferView | ArrayBuffer | undefined      0 refusals
  SharedArrayBuffer | undefined                  2 refusals
  ArrayBuffer | SharedArrayBuffer | undefined    2 refusals
  AsyncIterableIterator<number> (no union)       1 refusal
```

**143 of the 177 are two missing types**, and the union is doing nothing except
carrying them into the message. `SharedArrayBuffer` is already named as the
cause in the `instanceof` row — *"has no class, and it is what refuses the two
`value instanceof ArrayBuffer || value instanceof SharedArrayBuffer` sites that
read as `ArrayBuffer` failures"* — and this is the same type costing 58 more
sites under a message that does not mention it. `AsyncIterableIterator` is the
async iterator protocol row, which sizes itself at 63 and is really 85 here plus
whatever the second message holds.

**And `SharedArrayBuffer` has a cheap fix that should not be taken.**
`ArrayBuffer` is one line in `provided_representation` — `named(…) ==
Some("ArrayBuffer")` → `ManagedType::Buffer` — and adding a second name to that
condition clears all 58 sites in one character's worth of thought.

It is the wrong trade, and the reason is the direction of the failure. The two
types would then be one at run time: a value declared `SharedArrayBuffer`
crosses the napi boundary as an `ArrayBuffer`, and node is told a different
thing than the program said. `instanceof` stays refused either way, so nothing
would report it — the 58 sites would clear, the corpus would agree, and the
error would live at the boundary where this tree has the least coverage.
Silently permissive is what a shortcut here buys, and it looks like the best
result of the week.

The correct shape is a distinct `ManagedType` with its own descriptor, so
`instanceof` can tell them apart and the boundary can carry which one it has.
That is a runtime struct, a descriptor, a constructor and `grow`/`growable`
against `resize`/`resizable` — more than a line, and the only version that is
not a wrong answer waiting for a test.

**Why this belongs in the ledger rather than in an instrument.** Every census
this tree takes over diagnostics has the same defect and it is stated in
`tooling/conformance/gates.mjs`: the compiler reports one blocker at a time, so
a rank by message is a rank by diagnostic *reach*. This is the other half —
even at one site, the message names the **shape** the refusal was filed under
and not the thing that has to be built. Two minutes of building the union
without each member answered it; no amount of grouping the messages would have.

#### `Promise.withResolvers` — landed 2026-09-16

**This section concluded the wrong thing and is kept for the shape of the error.**
It read, until the fix: *"the blocker is a promise capability as a first-class
value ... what it needs is a closure capturing the promise ... the body would be
synthesized rather than lowered from source, which is new machinery."*

It needed none of that. The capability holds **nothing besides the promise** —
`resolve(v)` and `reject(e)` are the two settles the runtime already performs
with the promise as the receiver, and `.promise` is the identity — so
`PromiseWithResolvers<T>` is represented as `Promise<T>` and the members are
reached through the object rather than extracted from it. Twenty-three lines in
`representation_within`, a fifth arm in the `resolve`/`reject`/`all`/`race`
dispatch, and a settle that takes its receiver from the property access.

**Why the wrong conclusion survived.** It was reached twice. [[0337]] built this
exact representation, saw `addons.sh` regress 12 of 24, and inferred from
`broadcast.ts`'s `state.resolve = pending.resolve` that the members must be
first-class. The attribution was right — the regression was that change — and the
mechanism was not: a latent defect in the reject path, reachable for the first
time once the capability lowered ([[0339]]). With that fixed the representation
gives **24 of 24, 0 regressed**, and the five value-use sites refuse by name
without stopping any module building.

So "the one shape the representation cannot answer" was accurate, and the step
from it to "therefore the representation must go" was never measured. A refusal
at five distinct sites is not the same claim as a representation being wrong, and
nothing had asked what those five actually cost.

**Where it stands.** 22 distinct sites lower; 5 refuse as ``a promise
capability's `resolve` used as a value rather than called``. Those are
`broadcast.ts` (×2), `classic.ts`, `push.ts` and `http1/pool.ts`, and they want
[[0336]]'s decomposed form with a synthesized closure — still real work, no
longer blocking anything.

#### An optional method on an interface — 34 distinct

`a union of a function type | undefined`, and every site is an optional method
called optionally: `previous.uncork?.()`, `socket.setKeepAlive?.(…)`,
`this.socket?.setNoDelay?.(enable)`.

**The declaration form is the whole difference**, isolated on four arms:

    uncork(): void        required method    compiles
    uncork?: () => void   optional property  compiles
    uncork?(): void       optional method    refused

A method gets a vtable entry rather than a field, so the optional call lowers
its callee as a *value*, finds no slot, and `absent_member` reports the member's
type. The types are identical either way — `nts types` shows
`Function(SignatureId(4))` and `Undefined` for both spellings — so this is a
layout question wearing a representation sentence.

**Done 2026-09-16, and worth less than the 34 suggested.** `o.m?.()` is
desugared to the `InstanceOf` over the classes that declare `m` and the ordinary
method call in the present arm — the same test `in` emits, which is what made
`if ("uncork" in c) { c.uncork(); }` compile all along. No representation and no
storage: a class either has the slot or does not.

Measured on one tree against a control built from it: `http` 40 → 31, `stream`
28 → 25, `fs` 28 → 25, `net` and `timers` unchanged. Declined exports identical
everywhere, as expected.

**Both remaining halves landed 2026-09-16, and this paragraph had the second one
wrong.** It read: *"the remainder is `this.socket?.cork?.()` — doubly optional …
that is the larger half of the 34"*. It is not, and the error is worth keeping
because of how it was made: the remainder was characterised by **reading the
sites the first fix did not clear**, and a shape you recognise is the one you
count.

*Doubly optional* — `this.socket?.cork?.()` — turned out to be the smaller
problem and not a composition at all. **One test still, not two.** Both absences
produce `undefined` and the class test already answers for both: an absent
receiver is an instance of no class, so the arm that calls is exactly the arm
where the receiver is present *and* its class has the slot. The real work was
that `declares_an_optional_method` asked an object question of a union — the
receiver's type has an absence in it — and that the calling arm needs
`present_of` to read the payload back out of the tag. Twenty-odd lines.

*The presence test* is what the corpus writes, and nothing had counted it.
With both call forms lowering, **21 distinct sites** remained across `stream`,
`http`, `net` and `fs`, and **not one was a call**:

```text
  12  if (writer.writeSync !== undefined) { ... }
   6  if (typeof stream._construct === "function") { ... }
   1  if (!this.push(chunk) && stream.pause) { ... }
```

The same question, spelled as a test and a call rather than as one operator, and
the same question `"m" in o` has always answered. `!== undefined`,
`=== undefined` and the four `typeof` comparisons all lower to the class test
now — `=== "function"` and `!== "undefined"` ask for present, the other two for
absent. **`typeof o.m === "object"` and the rest are not folded in**: they are
constantly false for a method, and answering them would be answering a question
this was not asked.

**Truthiness — `if (o.m)` — is the one shape left**, and it is exactly **one
distinct site** in all 24 modules: `web-platform/src/streams/readable.ts:919`,
`if (!this.push(chunk) && stream.pause)`. Not done, and the reason is a trade
rather than a difficulty: the fix is a `lower_condition` helper replacing
`lower_expression` + `truthy` at five call sites, and five call sites for one
site is the wrong direction for a file this size. Counted across every module
before deciding, because the last characterisation of "what is left here" was
made by reading and was wrong in both halves.

Measured against the gated `27fe1e1e` binary, distinct sites of ``a union of a
function type | undefined``:

```text
  after `!== undefined`   stream 21 -> 7    http 26 -> 7   net 12 -> 5   fs 21 -> 7
  after `typeof`          stream  7 -> 1    http  7 -> 1   net  5 -> 1   fs  7 -> 1
```

All four converge on the same single shared site, which is a stronger signal
that the remainder is one shape than any reading of it would be.

`addons.sh` gives **24 of 24 still build, 0 regressed**, which is the check that
matters rather than the fixture — see [[0337]]. It did **not**, at first: the
`typeof` half took it to 17 of 24, and the cause was not the change.
`stream/src/legacy.ts:72` had never been lowered, so the virtual call inside it
had never been emitted, so [[0340]] — a virtual call coerced to the resolved
signature and dispatched through the slot's — had never been reached. Third time
in one day that clearing a refusal published a defect standing behind it. Fixed
first; this landed on top of it.

`examples/an-optional-method-called-optionally` is the fixture — **406 cases
across 14 functions, agreeing with node**. Ten refusals on the binary before the
`!== undefined` work and six more on the binary before the `typeof` work; this
row said 290 across 10 for a few hours after the second landed, which is the
stale-claim-as-a-diff this file exists to make visible. The arms that earn it are the ones where a skipped call and a taken
one differ: `Full.seen` starts at 0 and `note` adds, so a guard that fell the
wrong way answers 0 where node answers `by`.

**It was written on an `interface` and had to move to an abstract class, and
what that uncovered is a separate defect.** The interface version agreed with
node through C and threw through the JVM:

    java.lang.ClassCastException: class nts.gen.Full cannot be cast to
    class nts.gen.Corkable

That is **not about optional methods**. A *required* method through an
interface-typed receiver, with no `?.` anywhere, fails identically, and the same
program with `abstract class Corkable` instead agrees on both backends — two
arms differing in one word. **The JVM backend does not emit the `implements`
relationship**, so a call through an interface-typed receiver casts and fails.
Other examples use `implements` and pass because they never dispatch *through*
the interface type.

Recorded here rather than left in the fixture: a fixture that fails for
something other than its subject attributes the failure to the wrong change, and
this one would have read as "the optional-method desugaring is wrong on the
JVM". It is not; the lowering is the same on both backends and only one of them
mis-emits the receiver's type.

**It refuses by name now rather than throwing** — the JVM lane took it the same
day. `refuse_impossible_cast` fires at both `Unerase` sites where a receiver is
read back as a layout that other classes "declare they implement without
extending", and the first version guarded only one of the two, which left the
probe throwing unchanged: *two sites spelling one narrowing, and a guard on one
of them is not a guard.* Bounded rather than assumed — the `abstract class` form
of the same program still agrees at 29 cases, `examples/declared-wider` at 174,
the `jvm` step at 210 of 210 — and sabotaged: forcing the predicate false fails
exactly the new test and with a different code.

**The underlying gap is unchanged and is still the work.** `nts layouts` shows
the IR is complete — `A implements C` is there — so this is entirely the
emitter: `C` comes out `public abstract class` with a `double seen` field, `A`
and `B` come out `public final class` with no superclass, and the `checkcast`
cannot succeed. Emitting the relationship properly needs `inherited`,
`declared_member` and the `<init>` super chain to agree. What changed is only
that a program which compiled, loaded and threw now says so at compile time. Both arms of the class test run in every case, which the fixture
says out loud: a test stuck at `true` calls a method that is not there, and one
stuck at `false` skips a call that should have happened, and only a `Bare` class
beside the `Full` one can tell those apart.

**And the route is already open.** Presence of an optional method varies per
*class*, not per instance, which is exactly what `in` answers, and

    if ("uncork" in c) { c.uncork(); }

**compiles clean today.** So `c.uncork?.()` is that, desugared:
`lower_in_over_every_class` for the test and the ordinary virtual call in the
present arm. No new representation, no synthesized closure — which is why this
one is the better first move of the two despite being a tenth the size.

### `x?.m()` for a `void` m — one absence written twice, 2026-09-16

`a conditional of unrepresentable type (a union of undefined | void)` was 597
sites over 51 distinct locations, and every one is an **optional call whose
method returns `void`** — `controller?.abort()`, `capability?.resolve()`,
`this.#observer?.(size)`. The call is `undefined` when the receiver is nullish
and `void` when it ran, so the conditional an optional chain lowers to has that
type, and `lower_branching_value` needs a representation for its merge
parameter.

**The union arm already knew the answer and threw it away.** Its own comment
reads "`void` and `undefined` are the same value, so a union with both still has
one" — then both members are classified as absences, `continue`, nothing sets
`shared`, and `let shared = shared?` returns `None` for a type whose
representation is `Void`, exactly as either member alone. `null | undefined`
stays `None` and the distinction is the point: *two* absences with no payload
beside them have nothing to tell them apart with; one written twice does not.

**Then the change exposed two more, and the fixture found both — not reasoning.**

A change that makes the compiler accept more can make it emit what it cannot
compile, which is worse than the refusal it replaced. Giving the union a
representation produced **seven `use of undeclared identifier` errors** in the
first run of the example: the C backend declares no variable for a `Void` value,
so a merge parameter carrying one is assigned from both arms and read in the
merge. A `Void` conditional has no value to merge — the arms still run, only the
value is dropped — so the parameter is gone and the `undefined` is materialized
in the merge block.

That left two, and the second was subtler. `absences_of` collects one tag per
union *member*, so `undefined | void` came back as two `UNDEFINED`s. Two is
neither "an absence and nothing else" nor "never absent", so
`absence_the_type_decides` called it a real test and declined, and the
comparison fell through to the **erased** path — comparing an `NtsValue` against
a value nothing declares. The union's representation arm states the rule about
itself; this function did not follow it. Deduplicated.

| module | before | after |
|---|---:|---:|
| `http` | 58 | **0** |
| `process` | 54 | **0** |
| `fs` | 54 | **0** |
| `zlib` | 51 | **0** |
| `stream` | 51 | **0** |
| `net` | 39 | **0** |

307 → 0, with total `NTS1001` falling about 38 per module — less than the
specific count, because some functions advance to a later blocker.

**What it did not move: declined exports, 21/5/123/66/74/11, identical either
side.** `examples/an-optional-call-that-returns-void` is the justification —
**116 cases across 4 functions, agreeing with node on every one.** The arm worth
naming is `whetherItRan`: a void function returns `undefined`, so
`s?.take(v) === undefined` is `true` whether the call happened or not. **An
optional call cannot report whether it ran**, and that is the answer the erased
path was quietly getting wrong.

One shape is deliberately absent from the fixture: a nullable closure written as
a *conditional expression* is `an object type with no layout`, a separate gap
this change does not touch. The function-valued **field** form — which is what
the real sites use — is there and works.

### The largest refusal text, closed 2026-09-16

``indexing `X`, which stands for `X` here, which is not an array`` was **299
sites**, the largest single refusal text in the corpus. Every one of them is a
class member reached by a `unique symbol` key *from inside its own class*, where
that class is **generic**.

The asymmetry is the defect: the same member, reached two ways, and only the
computed spelling needed a representation. `names_a_property` sends a
`PROPERTY_ACCESS_EXPRESSION` down a path that never consults the receiver's
lowered type, and requires an `ELEMENT_ACCESS_EXPRESSION`'s receiver to be
`Managed(Object(..))`. TypeScript models `this` as a type parameter constrained
to its own class; for a **non-generic** class that constraint decomposes into an
object and the check passes, and for a generic one the constraint is the
*uninstantiated* form — `Holder<T>` — which `tsgo::decompose` leaves as a
`Structured` placeholder.

**And the stated ground for that placeholder is true of a generic function and
false here.** §16 records it as "only instantiations are ever lowered, so the
members of a form parameterised by one are members nothing can use", probed on
2026-09-15 with `g<T>(b: Box<T>): T` and found to hold. It holds for a generic
*function*. A method reaching its own field through `this` is the case it does
not cover, and `nts types` shows why in three lines: the polymorphic `this` is
`TypeParameter { name: "Holder", constraint: #6 }`, `#6` is `Holder<T>`
**Structured**, and `#15` — the instantiated `Holder<number>` — is a decomposed
`Object`.

**Measured on one tree, against a control built from the same tree minus the
change.**

| module | before | after |
|---|---:|---:|
| `http` | 26 | **0** |
| `fs` | 22 | **1** |
| `stream` | 20 | **0** |
| `util` | 20 | **0** |
| `timers` | 1 | **0** |

89 → 1. Every ``not an array`` refusal roughly halves with it: `http` 52 → 26,
`fs` 47 → 26, `stream` 40 → 20, `util` 38 → 18.

**What it did not move: declined exports, 74/21/29/123/41, identical either
side.** Which is what this section now expects of a lowering fix and states
before the queue. What it *did* buy is correctness reaching further:
`examples/a-symbol-key-inside-a-generic-class` reads, writes and
compound-assigns through two symbol keys inside a generic class and from outside
it — **87 cases across 3 functions, agreeing with node on every one**, and
refused by the pre-change binary with 4 diagnostics, so it measures something.
It carries a non-generic arm as well, which always worked, so a change breaking
that would show.

### The queue, with each root's own reason — 2026-09-15

`gates.mjs` could name a root and not say why *that root* was refused, so
establishing `asRequest`'s cause meant grepping a module's whole diagnostic
stream by hand and matching on a line number. The mapping existed the whole
time — `Program::uncompiled` is the only place a refusal is keyed by a **name**
rather than a span, which is how the napi wrapper answers at all — and **no
output mode printed it.** `nts refusals` does now, `name<TAB>reason`, off the
*prepared* program so that cascade entries are included.

| exports | root | its own refusal |
|---:|---|---|
| **22** | `asRequest` | `` `Arguments` ``, captured above its own declaration, where it has no value yet |
| 12 | `displayBytePath` | `this` outside a method |
| 9 | `uvException` | a `UVExceptionError` where a `UVError` is wanted — a pointer cast between two structs that do not agree |
| 5 | `validateOptions` | a `new` with arguments and no constructor |
| 4 | `objectToBuffer` | an erased value where a concrete representation is wanted |
| 4 | `channel` | a property `#map` of unrepresentable type (`Map<string \| symbol, WeakRef>`) |
| 4 | `toUnixTimestamp` | **`Date.now`, a global member with no definition here** |
| 4 | `validateBufferArray` | a `for...of` over an array of `any` |

**And the first thing it showed was about a change made two hours earlier.**
`asRequest` reads ``Arguments`, captured above its own declaration` — not "a
generic function no call pins down", which is what it said this morning. The
function-type arm added to `unify` moved the corpus's top root one link, exactly
as eight probe arms predicted. That movement is **invisible** in every number
recorded against that change — declines 505 either side, definitions 35,567
either side — and visible here. A fix that publishes nothing can still be the
difference between a blocker and the next one, and only an instrument keyed by
name can show it.

Read the rank with the standing caution attached — it is an upper bound, and
today is two for two on candidates collapsing to zero when actually tested. But
the *reasons* are new information and some are very small: `Date.now` having no
definition is a missing builtin standing in front of four exports.

### Deferred rather than rejected

Wanted, and not soon: `Atomics` and `SharedArrayBuffer` need an agent model and
a memory model on top of the threading the runtime already has, and they are the
one part of §13's neighbourhood that a native compiler could do *better* than an
engine rather than not at all.

## 14. Where the numbers come from

`tooling/gate/all.sh` runs all of it. Three measures, and they answer different
questions:

Every number below is from the gate on **2a1603b8, 2026-09-15**, read off the
run rather than carried forward — the previous set said 90 examples, 49 lowering
cleanly and 22 modules, and had been true at some point.

| | what it says | today |
|---|---|---|
| examples | the compiled program agrees with node, case by case | **208 of 208** — but see below: **9 of them compare nothing** |
| sweep | a generated cross-product agrees with node, cell by cell | 10,005 cases across 345 functions |
| corpus | arbitrary input produces no invalid IR and no C that will not compile | 184 single-file cases, 53 lower cleanly; `invalid HIR` 0, `uncompilable C` 0 — both hard rows |
| profile | how much of a real standard library lowers | 26 modules emit and verify; 18,257 refusals against 23,301 definitions |
| rc | the same examples hold nothing at exit under reference counting | 207 of 208 |
| LLVM / JVM | the same examples through the other two backends | 206 of 206 each |

**"208 of 208 agree" is not 208 examples checked.** The runner names the
exception itself and it is worth reading rather than skipping: *9 compared
nothing (no exported function with scalar arguments and a scalar result)* —
`advanced`, `calls`, `classes`, `dates-unsupported`,
`enum-reverse-map-unsupported`, `generator-unsupported`,
`generic-classes-unsupported`, `jsx`, `types`. Those nine are compiled and not
*run*, so an example among them can support a claim about what the compiler
**accepts** and never one about what it **answers**.

That matters to §6, because a ✅ row citing one of the nine cites a compile.
Checked 2026-09-15: two rows did. `declare` (ambient) also carries a probe, so
its evidence stands. **Type predicates did not** — the row cited
`examples/advanced`, whose only guard takes an object, and no case had ever been
compared. `examples/a-type-predicate-that-narrows` now runs it: 87 cases across
3 functions, agreeing with node. The row was true; its evidence was the syntax
being accepted.

The node lane found the same shape from the other side on the same day:
`path.matchesGlob` had never been called by their corpus, and the first run of
it disagreed with node on **1,257 inputs** over three separate rules. A function
nothing calls and an example nothing runs are one hazard, and neither reports a
failure — they report nothing, which reads as coverage.

### What the example comparison can see at all

Stated 2026-09-15, because it never had been, and it bounds every "agrees with
node" in this file. `tooling/differential`'s admissible types are

    Bool | Int { .. } | Float { .. }        -- `fn scalar`
    Managed(String)                         -- passed and compared separately
    Promise<one of the above>               -- driven to settlement

and nothing else. **No example ever compares an object.** Not a field, not a
prototype, not identity, not an array's contents.

That is not the same as saying object behaviour is unchecked, and the
distinction is the whole of it: an example can reach *any* behaviour, but only
by **projecting it onto a scalar itself**. `examples/key-order-follows-the-program`
is what that costs — to compare an enumeration order it encodes one:

    total = total * 128 + (keys[i] ?? "").charCodeAt(0)

a positional hash, written by hand, so that a difference in order becomes a
difference in a number. Covering a non-scalar class means somebody thought to
write the projection.

**So the hazard is a claim about object-shaped behaviour that no example
projects.** It is unobserved and reads as covered, because the gate reports 209
of 209 either way. Checked for the obvious one: enumeration order **is**
projected, by the example above and by `a-for-in-over-an-object`. A zero, and
the reason it is worth recording is that it took a projection somebody wrote
years before the question was asked.

The node lane hit the identical shape from the other side the same day, and
theirs bit. Their differential rendered results with `JSON.stringify`, which
**cannot see a prototype** — a null-prototype object and a plain one serialise
alike — so 110,470 comparisons were blind to that entire class, and two real
defects sat behind it: `url.parse(s, true).query` and `util.parseArgs().values`
were plain objects where node gives a null prototype, which is what stops
`?__proto__=x` and `--__proto__` from reaching `Object.prototype`. Fixing the
renderer was not enough on its own — a spec that returns a *string* flattens it
again in transit, so three specs had to return the container itself.

An instrument's observational limit is a property of the instrument, not of the
thing it measures, and it does not appear in its output.

### And the two limits that are not about scope

Recorded 2026-09-15 after both lanes hit each independently. Neither is an
instrument measuring too little; they are different failures.

**An instrument can participate in what it measures, and it looks like success
in both directions.** The node lane added a `console.error` to observe a race
and the write bought enough latency that the race stopped reproducing. On this
side, `addon.c`'s published-export count was being taken by grepping for
`napi_create_function`, and the fix — a comment telling readers to count exactly
that — put the token **in the file** and moved the count from 2 to 3. One made a
failure disappear; one made a number go up; both read as the fix working.

What works is not a better probe but a different one: **make the artifact state
its own number.** Every `addon.c` now ends with its totals, emitted by the
compiler, and nobody greps a file that answers the question itself. That has its
own precondition, learned by getting it wrong — the banner was first emitted
*before* the pass that fills the declined list and announced `fs` declines 11
against a true 123. A wrong number wearing the authority of having been printed
by the compiler is worse than no number, because nobody re-derives a figure the
artifact states about itself. Verified on four modules against their diagnostic
streams before it was believed.

**And an absence never fails — it is just not counted.** This is the one to
carry furthest. A behaviour comparison cannot call a function that was never
exported: the node lane found `Readable._fromList` already present and already
correct, missing only its export, and no amount of comparing could have found
it. On the same day this file learned that "209 of 209 agree with node" stands
over **nine examples that compare nothing**. Both are absences, and every
instrument in this tree measures *events* — a non-event is invisible to all of
them, and invisible is indistinguishable from fine.

`§15`'s declined-export work is the same shape one level up: 506 exports that
are not there, which no test could fail on, and which had to be counted
deliberately before anyone knew the number.

Only the examples and the sweep check **correctness**, and they check it
differently: an example covers what somebody thought to write down, a sweep
covers what nobody did. Every correctness bug found here by hand has been one
cell of a product — `null === undefined` answered true, `typeof f ===
"function"` answered false, a `bigint` `&` narrowed both operands to 32 bits —
which is the whole argument for generating them.

A sweep is only as good as its dimensions, and one of them was missing until a
wrong answer got through: every value was produced as an *expression*, and an
expression has the most concrete representation its type allows. The same
TypeScript type reaching a **parameter** can be represented differently, and
that is where `typeof` on a declared signature answered `"object"`. Each cell
now runs both ways.

The two measure different things, and a stretch of work can move one and not the
other. Four wrong answers were found and fixed in a run that took the profile
from 1,013 sites to 1,012: `typeof` on a declared signature, `pop` and `at`
answering NaN for `undefined`, `String()` handing a null pointer to a
concatenation, and a verifier that accepted a multiplication of a tagged value.
None of them was a refusal, so the reach number could not see any of them.

The corpus checks robustness; the profile measures reach and runs nothing, so a
function counted there is one that compiles rather than one known to be right —
and until recently it counted functions that could not even be emitted, because
the row that would have said so was collected and never printed.

Two ways the profile number has since been caught lying, both worth remembering
before quoting it:

- It once counted functions the verifier had never seen. `nts hir` verifies the
  **pruned** program, and an addon emits every *export* — so an exported
  function nothing calls was dropped before the check and compiled anyway. That
  is how `void FSWatcher__ref(...)` came to return a pointer.
- It went **down** by 26 once, and that was the fix: a return type with no
  representation used to default to `void`, so those functions were being
  counted as lowered while emitting C that does not compile.

`uncompilable C` had the same shape of problem. The emitter *silently dropped* a
struct field whose C type it could not compute, while the descriptor beside it
kept taking an `offsetof` into it — a struct missing a field the reference map
still points at is not a smaller object, it is a wrong one.

It is fixed now, and neither horn of the dilemma the note described was
necessary. Every managed object is one pointer whatever its layout; the
reference map wants an offset and a pointer has one; and nothing can dereference
such a field, because reading through it would have called `layout_of` and there
would be a layout. So it is emitted **opaque** -- which is also where LLVM
already is, having had none but opaque pointers since 17.

93 across the node profile, not the five this section used to claim, and it is
3: the three that remain are `layout_of` failing where a function genuinely
reads through the type, with a source location. **`uncompilable C` is 0** and is
a hard row now, as its note always said it would become when it got there.

Before it was fixed it was named, and that alone is worth recording. Nor are they obscure: a cell's `value`, a closure's
captured `callback`, `Agent.requests`. Naming them cost nothing — 90 of 90
examples still agree.

What it did surface is that `uncompilable C` was two different things in one
number. The check returned a single error for "the backend declined" and "clang
rejected what we wrote", so a *named refusal* was counted as malformed output.
Those are not the same failure: the first emitted nothing and said why, which is
what every refusal does. They are separate now — `uncompilable C` stays at 2 and
means clang, and a backend refusal is reported as one. A number is only worth
ratcheting if everything in it is the thing the number is named after, which is
the same lesson the `rc` list taught two sections up.

### The compiler computes its own offsets now, and clang checks them

Descriptors were built with `offsetof`, on the principle that the compiler which
laid the struct out is the one that says where its fields are. That is exactly
right while C owns the layout, and it stops being available the moment anything
else does: a second backend emits its own aggregates and has no `offsetof` to
ask.

So the placement moved into `nts_codegen_common::layout` — the platform C ABI's
rule for a struct, which SysV and AAPCS64 agree on for everything here: a field
starts at the next offset that is a multiple of its alignment, the struct's
alignment is the widest field's, and its size is rounded up to that. Every
managed value is one pointer, which is what lets a field whose type has no
layout be placed exactly without one; `NtsValue` is two words; a `bigint` is the
only thing here wider than a word, and it drags the whole object's alignment to
sixteen.

The C backend keeps `offsetof` for one purpose: to **check** this, on every
build, with a `_Static_assert` per field and one for the struct's size. The
claim and the oracle side by side. Across the node profile that is **10,340
assertions, and clang agrees with all of them** — so the number that matters
here is not that the engine works but that a disagreement would stop the build
with the field's name in the message.

They stay side by side until the claim has gone long enough without being wrong
to become the authority. The C backend has no reason to stop using `offsetof`;
the one that comes next has no way to start.

## 15. What to do next, ordered by evidence

### Rebaselined 2026-09-15

The numbered rows further down were measured on 2026-09-08 and are kept for
their reasoning, not their counts.

    instrument   tooling/conformance/refusal-census.mjs
    taken        2026-09-15
    compiler     a10b27ca, a copy pinned before the run
    population   26 modules

    881 distinct named things behind 1378 sites, 208 distinct root messages
    1538 further things refuse only because something they call was refused
    493 exports the wrapper declined, which emit no diagnostic at all

The same instrument over **22** modules on 2026-09-11 reported 812 behind 1379,
158 roots, 1284 cascade-only and 479 declined.

**Those two sets of numbers do not form a direction, and the reason is the
population rather than the instrument.** The corpus went from 22 modules to 26
in four days; 881 against 812 is four more modules' worth of code as much as it
is anything the compiler did. Every number above carries its date, its
instrument and its module count for that reason — a count whose population is
unstated is a number two people will read differently, which is what §14
records this file already doing once.

What *can* be read across the two is a ratio, and one moved: cascade-only was
1.58× the named things and is now 1.75×. That is a claim about shape rather
than size, and it says the tail of things blocked only by something else grew
faster than the roots did. It is not evidence about any particular root.

**Do not read any of it against the 1,097 below.** Those are different units
counted by a different instrument.

The ten largest roots, by *things* rather than by sites. Truncated where the
census truncates them, with the blocker each is filed under where it has one:

| things | sites | mods | root |
|---|---|---|---|
| 48 | 66 | 20 | a pointer cast between two native types — `annotated-const-read` |
| 45 | 47 | 15 | a member on an intersection, which is erased here — `an-intersection-from-an-in-narrowing` |
| 27 | 33 | 13 | a member a type does not declare |
| 25 | 34 | 16 | a method with no declaration in the hierarchy — `a-generator-method` |
| 24 | 24 | 19 | an erased value where a concrete representation is wanted — `intersection-from-two-narrowings` |
| 24 | 30 | 9 | a member declared with a type that has no representation — `a-method-assigned-per-instance` |
| 24 | 24 | 9 | a conditional of unrepresentable type (a union with `undefined`) |
| 22 | 30 | 14 | a global member with no definition here — `json-stringify` |
| 21 | 31 | 9 | a function returning an iterator — `a-function-returning-an-iterator` |
| 18 | 40 | 18 | a parameter of unrepresentable type — `for-await-loop` |

**This table is not the 2026-09-11 one with different numbers in it, and no row
should be read against that one.** Four days and four more modules separate
them, and the census reports a *message* rather than a construct — a root can
change its wording without changing what it refuses, and two roots can merge.
Comparing rows across the two would be the same mistake as comparing the totals.

**A root leaving the census is not evidence it was fixed**, and the clearest
case here is one I nearly recorded the wrong way round.

`then` on a promise held 22 things across 21 modules on 2026-09-11 and appears
nowhere in the 208 roots of the `--top=250` run. Absence is checkable where a
rank is not, so that looked like the one real change this pair of tables
supports. It is not: `tooling/conformance/blockers/a-promise-method-call` opens
`// expect: a method call on something without methods` and describes `.then` on
a promise. The construct still refuses. **The message was renamed**, and under
its new wording it is 15 things across 24 modules — fewer things, more modules,
and nothing was fixed.

So the census reports *messages*, which is what it can see, and a message is not
a construct. What settles "does this still refuse" is the blocker: it carries
the expected diagnostic beside a description of the shape, so a renaming shows
up as the two disagreeing rather than as a row vanishing. Reading a root's
absence as a fix is the mirror of reading a truncated table's absence as zero
reach, which this file has already paid for once.

### The half the roots table cannot see

The 493 declined exports emit no diagnostic, so none of them is in the table
above. Read on 2026-09-15 from the same run, at `--top=250` so that all 166
reasons are present rather than the top ten:

| | exports | reasons |
|---|---|---|
| name a representational cause | 315 | 98 |
| point at another declaration — *it calls `X`, which was refused* | 124 | 65 |
| **state only an effect** | **54** | **3** |

**This is the item that had already mostly been done, and the ledger did not
know.** The line here read *228 of them say only "no function of that name was
compiled"*. That message is now 4 exports across 4 modules. What remained were
two others of the same shape — *is a class whose constructor was not compiled*
(30) and *is a namespace member whose function was not compiled* (20) — which
say the thing they depend on is missing without saying which thing or why.

The mechanism was findable because the napi wrapper already tries: every one of
these goes through `why_uncompiled`, which looks the name up in
`program.uncompiled` and falls back to the bare sentence when it is not there.
So the question was never "what phrasing" but **which drops forget to record**.
Two did:

- `settle`'s `NTS2006` loop, which refuses a function for native storage or a
  bridged body that suspends, removed it from `funcs` and reported a diagnostic
  without pushing to `uncompiled`;
- the reader of a global whose initializer was refused, the same.

`drop_callers_of_refused` beside them had recorded its reason since it was
written, which is why the cascade half already answers with *it calls `X`*.

A cascade pointer is not a root cause — *it calls `asRequest`, which was
refused* names where to look next, not what could not be carried — but it is a
walkable chain, and 124 of these are on one. The 315 that name a cause are
rankable beside the roots table; the 124 have to be followed first.

#### What the remaining 54 are, traced rather than counted

Recording the cause at the two drops above moved the effect-only count from 54
to **53**. That is not a fix and it is worth writing down as one of the ways a
diagnosis fails: the mechanism was real — both sites did drop a function without
saying why — and it was not the mechanism behind these.

Following one case answers it. `stream` declines `Readable`, `Stream` and
`Duplex` with no cause while `PassThrough` gets *it calls `Transform#constructor`,
which was refused*. So the wrapper's lookup works; what differs is the entry.

Verified by reading the dumps: `Readable#constructor` is absent from the
prepared HIR **and from the unprepared one**, while `runtime/node/stream/src/readable.ts:299`
declares a constructor and 526 other constructors are lowered. So it was never
lowered rather than lowered and dropped, and `program.uncompiled` — which
records refusals — has nothing under that name to find.

The refusal itself is there: `readable.ts:296 NTS1001 a method without a body`,
which is `_construct?(callback): void`, a member declared without one.

**`note_uncompiled` records in a different vocabulary.** It keys on
`declared_name`, which is syntax — `parse`, `isWritableStream` — while every
reader asks in the lowering's names: `Catalog#parse`, `Readable#constructor`.
Measured on `stream` with a probe at the recording site: **51 entries under a
Readable/Stream name and not one containing `#`**. So a refused class member is
recorded and can never be found again by the wrapper that wants it.

That is now fixed — a refusal is filed under the qualified name as well, which
is what `lower.rs` spells when it builds `format!("{owner}#constructor")`.

**But it is not why these three decline without a cause, and the first
explanation here was wrong.** This section previously said `declared_name`
returns nothing for a constructor and `note_uncompiled` silently returns. A
probe printing every such early return found **zero** across the whole of
`stream`. The inference was marked as an inference, which is the only reason
checking it was possible.

What is established: `Readable#constructor` has no definition in the program
*and* no refusal naming it, while `Duplex#_final` and its siblings are lowered
normally, and `PassThrough` does get a cause because the cascade names
`Transform#constructor`. A constructor that is neither compiled nor refused is
a third state, and the message the wrapper gives for it — "was not compiled" —
is accurate about all three, which is why it reads as one problem. Open.

A caution earned three times in one sitting: `Stream#constructor` matched
`WebSocketStream#constructor` and `Duplex#constructor` matched nothing it
appeared to, because substring search has no notion of a name boundary. Every
count above uses one.

#### Closed 2026-09-15: the third state was a pass that reported and did not record

The constructor that is "neither compiled nor refused" was neither, and the
reason is one line. **A class member is never lowered through the arm that
records a refusal.** `lower` routes a `CLASS_DECLARATION` to `lower_class` and
continues; `lower_class` ends its member loop with

    Err(diagnostic) => lowered.diagnostics.push(diagnostic)

so every refused method and every refused constructor in the program was
reported to a person and left out of the list the next pass reads. The two
sites in `hir/mod.rs` that already carry a **"Recorded, not only reported"**
note are the same omission one layer up; this is the third, and the one that
holds all the classes.

Two further faults sat in `note_uncompiled` and would each have been enough on
their own, which is why fixing either alone showed nothing:

- **A constructor has no declared name.** `declared_name` returns the text of
  the first `IDENTIFIER` child, and `constructor` is a keyword — so the
  function returned at its first line and recorded nothing at all. The
  `CONSTRUCTOR` arm added to `qualified_name` on 2026-09-15 was dead code from
  the hour it was written.
- **The simple name short-circuited the qualified one.** Returning early when
  the bare name was already present meant the second class to refuse a member
  called `parse` never got its `B#parse` entry. `stream` refuses four
  constructors; on that order at most one could ever have been recorded.

**Measured across all 26 modules, both binaries, same tree.** Effect-only
declines — the ones whose whole reason is `was not compiled` or `is not a
function this backend can name` — go **117 → 91**. Total declines are **500
either side**, which is the check that matters for a change that adds text: no
decline was hidden, 26 gained a cause.

In `stream`, causeless class declines go 7 → 3, and the four that fall are the
four classes that declare a constructor:

| class | the cause it now gives |
|---|---|
| `Readable` | `` `_read` ``, declared by `Readable` with a type that has no representation (a function type) |
| `Duplex` | a `DuplexOptions` where a `ReadableOptions` is wanted — a pointer cast between two structs that do not agree |
| `Transform` | a `TransformOptions` where a `DuplexOptions` is wanted |
| `Writable` | a `Writable` where a `WritableImplementation` is wanted |

**Three of those four are the top root of the census table** (44 distinct things
over 62 sites), so this is where the two halves of §15 actually join: the
largest module-level decline and the largest root message are the same defect,
and nothing said so until the decline could name a cause. `Readable` is also
what `prize.mjs` ranks first in `stream` — 80 of 251 test files name it.

The three that remain are `Stream` twice and `iter.Stream`, and they are a
different thing: **those classes declare no constructor at all.** Checked
rather than assumed — a class with no explicit constructor and a live `new`
emits **zero** `Owner#constructor` functions, because the allocation and the
field initialisers are inlined at the `new` site. So there is nothing to
refuse and nothing that was dropped; the wrapper needs a function that this
lowering has no reason to emit. That is a feature gap, correctly named, and it
is what the largest remaining bucket is made of: **63** declines now read `is
exported and is not a function this backend can name`, against 20 namespace
members and 7 classes.

#### And then the bucket below it, same day: a cause recorded and never read

**Closed too, and the chain hypothesis it suggested was wrong.** Classified
against the source, all 63:

| kind | count | what it is |
|---|---:|---|
| `export class` | **35** | an exported class the wrapper never treats as a class at all — it does not reach the `class_definition` path, so it gets the export pass's generic sentence rather than a constructor one |
| `export const` | **22** | a function bound to a `const` rather than declared. `assert` is 18 of these on its own: `export const deepEqual = ...` |
| neither found | 6 | `default` and re-exports, not run down |

The 35 is the larger half and it is **not** the no-constructor gap above.
What excludes them: **`class_names` is the owners of surviving `Owner#member`
function names**, so a class whose every member died is not in the wrapper's
set of classes, never reaches `class_definition`, and never gets asked the one
question that would answer it. `ZlibBase` keeps a member and so is asked;
its fifteen descendants keep none and get the generic sentence. That is the
whole of the 15-vs-1 split in `zlib`, and it is mechanical rather than a
property of the classes.

And the cause was **recorded the entire time**. The cascade writes ``it calls
`Base#constructor`, which was refused above`` into `uncompiled` under
`Middle#constructor`; nothing read it. Asking `uncompiled` for
`{name}#constructor` before falling back is self-limiting — nothing but a class
puts that key in the list — so a non-class export falls through exactly as
before.

**The chain walk was wrong, and this is the entry that says so.** `Gzip`
descends from `Zlib` from `ZlibBase` from `Transform`, `Transform#constructor`
is named once in `zlib`'s output and the three zlib constructors zero times, and
the obvious reading — that the four stream classes are the root of the fifteen —
was never asserted here for exactly the reason it turned out to be false. What
the fifteen actually say, once they can say anything:

    a property `dictionary` of unrepresentable type
    (a union of `ArrayBufferView` | `ArrayBuffer` | ...)

An options-bag property with a union type. Not inheritance, not `Transform`,
not the stream hierarchy at all. A plausible shared ancestor, verified to
exist, and not the cause — §14's standing warning, paid for again and this time
before it reached anybody's plan.

**Measured over all 26 modules, both fixes, old binary against new, same
tree.** Effect-only declines **118 → 65**; total declines **502 either side**.
(The earlier run in this section read 500 against 117; the node lane committed
to `runtime/node` between the two, so those two totals are not comparable and
the 118 is this run's own before-column. A sweep cannot outlive a moving tree.)
`zlib`'s generic sentence goes 15 → 1, `http` 11 → 4, `net` 7 → 3, `timers`
18 → 15, `stream` 29 → 24.

And what was behind them, ranked — which is the thing §15 asks for and could
not previously be asked at all:

| declines | the cause they name |
|---:|---|
| **15** | a property `dictionary` of unrepresentable type (a union of `ArrayBufferView` \| `ArrayBuffer` \| …) — every one of them `zlib` |
| 7 | a method without a body |
| 3 | `_writeVector`, declared by `Socket`, with a type that has no representation |
| 2 | it calls `bigintColumn`, which was refused above |
| 2 | `dispatchCapturedRejection`, a static field this compiler gave no storage |

**Corrected within the hour, and the correction is the point of the table.**
The sentence that stood here said "one cause is worth fifteen exports". It is
worth **zero**. The node lane removed `dictionary` in a detached worktree and
re-emitted: the refusal disappears — 104 lines to 0 — and the declined set is
**identical name for name**, 66 either side, category distribution unchanged.
Not one export was gated by it.

What it was standing in front of is the pointer-cast root:

    no wrapper for Brotli: ... a `BrotliOptions` where a
      `CompressionStreamOptions` is wanted, which is a pointer cast between
      two structs that do not agree about where their fields are
    no wrapper for Gzip:   ... it calls `Zlib#constructor`, which was refused above

So **a rank by count is a rank by diagnostic reach, not by value.** The
compiler reports one blocker at a time, so the cause with the most mentions is
whichever sits furthest forward in the program, and that is uncorrelated with
how many exports it gates. The table above is accurate and its ordering does
not mean what a reader will take it to mean — which is why the sentence is left
in place, struck, rather than quietly replaced.

The measurement that *does* answer "is this cause worth anything" is removal in
a throwaway worktree followed by a diff of the export set, and it is cheap
enough to run per candidate. One trap in running it, walked into and recorded:
the first attempt took declines from 66 to **0**, which reads as total success
and was a failed compile — `TS2358`, nothing emitted, therefore nothing
declined. Assert `wrote program.c` before reporting any count. Smaller output
is never evidence.

The original sentence, for the record: *one cause is worth fifteen exports and
it is a **declaration** in `runtime/node/zlib`, not a lowering.*

#### Item 3 redone, by what a fix clears rather than by what it says

`tooling/conformance/gates.mjs`, 2026-09-15, 26 modules. The correction above
says a rank by count is a rank by diagnostic reach; this is the ranking that
does not have that defect. A declined export names a cause, and where the cause
is a cascade — `it calls X, which was refused above` — X has a cause of its
own. Following those edges to a function with no outgoing edge gives the
**root** the export stands behind, and roots rank by how many exports reach
them.

    505 declined exports
    128 reach a root through the cascade
    241 are their own root -- a reason, and no chain
    135 name no cause at all

| exports | modules | root |
|---:|---:|---|
| **22** | 1 | `asRequest` |
| 12 | 1 | `displayBytePath` |
| 9 | 2 | `uvException` |
| 5 | 1 | `validateOptions` |
| 4 | 4 | `objectToBuffer` |

**The top root is a generic function no call pins down.**
`fs/src/request.ts:15` declares `asRequest<Arguments extends unknown[]>`, and
its terminal refusal is

    NTS1001 a generic function no call pins down (the type parameter `Arguments`)

with 22 `fs` exports behind it — `access`, `chmod`, `chown`, `copyFile`,
`fchmod`, `fchown`, `fdatasync`, `fsync` and the rest, each declining only as
*it calls `asRequest`, which was refused above*. That message appears **36
times in `fs` alone**. It is the same name this file already records as having
"sat at the head of the node profile for a day while being invisible to every
census, because a census reads diagnostics" — and it is invisible to a rank by
count for the same reason, since it is one message standing behind twenty-two
silent declines.

**What this number is, precisely: an upper bound.** Fixing a root clears its
chain only as far as the next blocker, and the compiler stops at the first, so
the blocker beyond it has never been printed. The only way to collapse an
upper bound to a real number is the node lane's worktree test — remove the
construct, re-emit, diff the export set — which is cheap enough to run per
candidate. This is a queue to run that test against, in order. It is not a
promise, and the `dictionary` correction above is what happens when a ranked
list is read as one.

**And what it did not move.** Nothing yet: no fix has been made on the strength
of it. The three counts it reports about itself are the honest shape of the
problem — only **128 of 505** declines stand behind any shared root at all, 241
are independent one-export causes, and 135 still name nothing. So even a
perfect run down this queue leaves the larger half untouched, and "find the
lever" is the wrong frame for three quarters of this set.

Two limits the instrument states in its own header rather than leaving to a
reader: a cycle among the edges is cut at the first repeat and reported as the
root, which is a choice and not a fact; and an export declining for its own
reason ranks as one export however expensive it is.

#### The top root, run down: a real gap, and a measured zero

`hir::generics::unify` had two structural arms — bind a type parameter, and
descend through `Array`. **No function-type arm.** So a type parameter named
only by a callback was never pinned, the call was skipped, and the declaration
was refused as "a generic function no call pins down". Nine probe arms fixed
the rule, and the pair that states it is:

    call<T>(f: (a: T) => T): T        compiled -- because the RETURN is `T`
    g<T>(f: (a: T) => void): void     did not  -- `T` is only in the callback

Both pin `T` to any reader. The second is `asRequest<Arguments>`. A function-type
arm is added, arity-matched, depth-bounded at 8 because a type's structure is a
graph and not a tree.

**What it moved: two shapes of fifteen.** `cbParamOnly` and `cbReturnOnly` clear
outright. Six advance one link to a *different* refusal — four to ``T`,
captured above its own declaration`, two to `an object type with no layout` —
and seven were already clean. No arm regressed.

**What it did not move: anything the project counts.**

| population | before | after |
|---|---:|---:|
| declined exports, 26 modules | 505 | **505** |
| definitions emitted, 26 modules | 35,567 | **35,567** |
| single-file corpus, lowered completely | 53 | **53** |

Not one export, not one definition. The node lane ran the worktree test on
`asRequest` independently and got the same answer from the other side:
specialising it for two `fs` functions left the declined set identical name for
name, and the reason changed from ``it calls `asRequest`, which was refused
above`` to **`takes an object`**. A callback is an object and an object does not
cross N-API, so that axis is bounded by the boundary rather than by any
lowering. Removing a root advances the chain; it does not clear it.

`examples/a-generic-pinned-only-through-a-callback` is the fixture — **58 cases
across 2 functions, agreed with node on every one**, and refused by the
pre-change binary, which is what stops it from being a test that measures
nothing. The shape that returns a function type is deliberately absent: it is
`asRequest`'s exact shape and it does *not* compile, so a fixture carrying it
would assert a pass this change does not deliver.

**Two for two, and that is the finding rather than either zero.** Both
candidates promoted by a ranking collapsed when tested. The reason is the same
both times and it applies to `gates.mjs` as much as to the census it improves
on: *the compiler stops at the first blocker, so anything it prints describes
the front of a chain, and being in front is uncorrelated with being
load-bearing.* A better question, asked of the same output, inherits the defect
one level down.

**And an instrument error of my own, in the same hour I was recording
everyone's.** The probe sweep that produced "four arms now compile clean"
grepped `NTS1001` and printed `compiles clean` for anything else. Two of those
four were failing with `NTS2006`. The corrected number is two. A filter named
after one diagnostic answers about that diagnostic, never about whether the
program compiled — count *all* diagnostics, or count what was emitted.

**And a second one, in `gates.mjs` itself, found from the node lane's side.**
They reported that a set difference over diagnostic text had called
`addListener<obj6704>` becoming `<obj6705>` a new line — a renumbering read as a
change. The same instability was in my root names and doing the opposite
damage: monomorphisation and closure capture spell one declaration several ways,
so `asRequest` and `asRequest<[erased]x2>` ranked as **two roots five exports
apart**, and `getHighWaterMark@0obj8148_1obj7883` sat beside
`getHighWaterMark@0obj8252_1obj7880` at one export each. Splitting a root buries
it; the unit of a fix is the *declaration*, because fixing `asRequest` fixes
every copy at once.

Measured on one tree, committed instrument against corrected: **`asRequest`
16 → 22**, four spellings collapse into their declarations, total roots 60 → 57.
Nothing else moved a rank.

Two things that only the control showed. The first attempt stripped
`<obj[0-9]+>` and `<[0-9]+>` — **the two spellings that appeared in the rows the
table prints** — and left `asRequest<[erased]x2>` split off, because that one was
among the 33 roots the table does not show. *An enumeration taken from the
visible rows is an enumeration of the visible rows.* And the first comparison
changed two variables at once: the instrument **and** the tree, since the node
lane committed to `runtime/node` between the runs. `asRequest` reading 22 then
16 was the tree, not the fix, and the only way to see that was to run the
committed instrument again on today's tree — which needed copying it back into
`tooling/conformance` first, because it derives its root from its own location
and answers about `$HOME` from anywhere else. The trade it described — narrowing
`dictionary` costs an interpreted-lane API that no longer accepts what node
accepts — was real and correctly flagged by the node lane before either of us
acted on it. It simply never had to be made, because the gain was zero.

`compiler/core/tests/constructor_refusal.rs` is the regression, and it has two
controls that can fail: the fixture must actually refuse `_read` with a named
cause, and the class that does compile must keep its constructor — without
both, the assertion would pass on a program that compiled cleanly. It carries
two classes rather than one, because one cannot catch the dedup fault.

Two instrument errors, both paid for here. The first count of "causeless" was
`no wrapper for X: <reason with no colon>`, which sweeps in `returns an object`
and `takes an object` — reasons that are complete in themselves. The number
above counts the effect phrases by name instead. And one reason *contains* a
colon, so `[^:]*` split it in the wrong place and reported it as effect-only
when it names a cause.

### What a fix would publish, measured

    instrument   tooling/conformance/prize.mjs --all
    taken        2026-09-15
    compiler     f7c451e6, a copy pinned before the run

For each module, node's own tests run twice: against the TypeScript on node, and
against the compiled `.node`. A file that **passes interpreted and fails
compiled** is one the implementation already gets right and the compiled
artifact cannot yet reach. That set is the prize.

**25 modules, 1,998 files passing interpreted, 48 passing compiled, 1,950 to
gain.** The compiled lane reaches 2.4% of what the implementation already does.

| module | interp | compiled | to gain | most-named |
|---|---:|---:|---:|---|
| `http` | 408 | 3 | **405** | `createServer` (273) |
| `fs` | 351 | 4 | **347** | `mkdirSync` (57) |
| `stream` | 252 | 1 | **251** | `Readable` (80) |
| `net` | 155 | 6 | **149** | `createServer` (98) |
| `async_hooks` | 118 | 2 | 116 | `createHook` (65) |
| `child_process` | 109 | 0 | 109 | — |
| `process` | 90 | 0 | 90 | `_fatalException` (75) |
| `dgram` | 77 | 0 | 77 | `createSocket` (68) |
| `zlib` | 68 | 1 | 67 | |
| `timers` | 60 | 0 | 60 | — |

**This is a different ranking from the roots table above, and it is the one to
act on.** §15 records `last-mile.mjs` naming `internal/errors.ts:547` as reached
by fifteen of twenty-two modules; it was cleared and none of the fifteen moved.
Reach counts how many chains pass through a point and says nothing about what is
on the other side.

**The `most-named` column is where the two halves of this section meet.** It
names the export whose absence the failing tests mention most. For `stream` it
is `Readable` at 80 of 251 — and `Readable` is exactly the export the napi
wrapper declines with *no cause*, traced above. The largest single nameable item
in that module is a decline the census cannot see, which is what §2's half-that-
cannot-be-seen predicted and this instrument confirms independently.

`http` and `net` both name `createServer`, 273 and 98. Four modules name nothing
at all — `child_process`, `timers`, `events`, `console` — which means their
failures do not mention a missing export, so the cause is elsewhere and the
`most-named` column is not a ranking for them.

**`inverted` is 0 for every module.** No file passes compiled and fails
interpreted, so nothing here is the compiled lane being *more* correct, and the
gap is one-directional.

### First, by whether anything can check it

The queue splits on a line that has nothing to do with difficulty: **node 24
strips types, it does not transform them**, so it refuses to *run* a file
containing a construct that has to be emitted rather than erased.
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, before a single test executes.

- **`enum`, `const enum`, and `namespace` with code — no oracle.** Node will not
  run the file at all. The differential, which this project calls its oracle,
  has nothing to compare against, so building these means shipping constructs
  only the corpus sees. About 10 of the queue. That is a decision about tooling
  -- transform with tsgo before handing the file to node -- and not about the
  lowering.
- **Everything else — checkable today.** `console.log`, a `Date` property, a
  rest parameter, a tagged template, `for...in`, `for...of` destructuring, a
  method on an object literal: node runs all of them, verified together in one
  file. About 28 of the queue.

Build the second group first. Not because it is easier, but because a refusal
replaced by an unverified answer is the trade this file exists to refuse.

### Then, by what real code needs


From the node profile's refusal sites — 1,097 of them, counted **once each**.
The raw sweep reports about five times that, because a module is re-compiled
once per importer and `util/types.ts` is counted twenty-one times over. This is
the only list ordered by what real code actually needs rather than by what looks
incomplete.

Read the counts as *upper bounds on what is visible*, not as effort. Twice this
week a tall row was one thing repeated, and twice it was several unrelated
things sharing a message — so the first move on any row below is to name what it
blocks on, not to start building.

| | what it unblocks | shape of the work |
|---|---|---|
| closures and function values | **done**, all four rows. 101 sites, and the profile went 1,155 → 1,041 across the four changes | a function as a value, capture by reference, module-scope names, and a capture above its own declaration. What is refused is one thing: a `for` loop's own variable, which JavaScript rebinds per iteration |
| module evaluation | 81 — one refusal repeated across the top level of nearly every module | a statement at module scope that is not a declaration; the evaluation order is already modelled |
| ~~a class as a value~~ | **done**, and it was the largest single row in the profile by an order of magnitude: **1,865 occurrences across 88 sites**, gone. `runtime/node` went 9,208 → 7,324 refusals. It needed no new machinery: a class used as a value is what a *named function* used as a value already is — one immortal static per class, tagged `FUNCTION` because its type id sits in the closure band, compared by address. What it needed was a **name**, because a token holds nothing and `same_shape` merges every empty layout with every other. Record 0162 |
| a member a type does not declare | 62 — 26 of them on an anonymous type, then `StreamLike` (12) | mostly structural types the decomposition stopped at; count before building |
| a global member | 64 — a long tail: `Object.defineProperty` 14, `Array.from` 10, `ArrayBuffer.isView` 7 | the largest entry is §13's, so this row is smaller than it looks |
| `instanceof` | 55 sites, and the 59 that were one idiom — `override get ["constructor"]() { return TypeError; }` — are closed with the row above. What is left is a **natively-represented** right-hand side | three separate reasons and naming them together would hide all three: `Map` and `Set` are one `NtsMap`, so a runtime test cannot tell them apart; `Uint8Array` and `number[]` are one `Managed(Array(..))`, which §16 records; and `RegExp` and `WeakSet` have no representation at all. `ArrayBuffer` has one since it became `ManagedType::Buffer`, so its half of this is now a lowering that nothing wired rather than a representation that does not exist |
| the async iterator protocol | 63, all `AsyncIterableIterator` — and a **second** 62-site row is the same thing under another message, a property `#lineObjectStream` of type `AsyncIterableIterator \| undefined`. One property, counted 62 times | §10 plus the suspension machine, which `async` already has |
| `symbol` | 46 — `string \| symbol` as a property key, 30 as a parameter and 16 as a property | a representation, and a decision about whether well-known symbols are values or names |
| a method not in the hierarchy | 52 — `emit` 8, then a long tail | structural dispatch, which is the same question as the anonymous-type row above |
| ~~array methods on a non-numeric array~~ | **done**, 22 → 4 → 1. Every site wanted a *reference* element, so there is a `_ref` family and no `_bool` one; `shift` and `splice` have since landed for both | what is left is `toSorted`, one site |
| string methods | 3 — `normalize`. `toLowerCase` and `toUpperCase` are done, which was 39 sites; `split`, `trim`, `replace`, `replaceAll`, `padStart`, `padEnd` and `valueOf` before them | the case tables are vendored and `normalize`'s came with them; it wants `dbuf` and an allocator argument |
| generators | 4 refusals, but `readline` and several streams are behind them | the suspension machine exists; what is missing is the `Generator<T>` object and §10's protocol |
| ~~`try`/`catch`/`finally`~~ | **done**. A handler is a block and a `throw` is a jump to it, carrying the thrown value as a block argument — so there is no unwinder, no landing pad and no table, and a `throw` caught in the same function allocates nothing | what is left is a `throw` that crosses a *call*, which is where 0070's pending slot belongs; 0071 has the shape |

Two rows in the corpus are meant to be zero, and both are: `invalid HIR` and
`uncompilable C`. Neither is ratcheted any more.

### What came off this list

`typeof` (25) and absent literals (33 → 16) came off together, and neither was
the shape its message suggested. `typeof` was not waiting on a tag: every
answer it refused was fixed by the representation, or by one branch on a
pointer that carries a single absence. The absent-literal row was not waiting
on a representation either — half of it was `x == null` on a type with no
absence, which is a constant the equality algorithm reaches before it converts
anything, and the other half was `callback(null, …)`, which was refused because
an argument's `parent` link points at a list node and the rule that reads
argument positions had never once matched.

Kept because the reasons are more useful than the checkmarks. `Map` and `Set`
(~150) were one hash table. Typed-array methods (56) turned out to be 34 calls
to Buffer's *own* methods on its own `this`, and four lines fixed them. Tuples
(40) and `bigint` (47) were both hiding inside a single row that said `Map`
until the refusal named its type arguments. The iteration protocol was mostly
not needed: a `for...of` over a known shape never wanted an iterator object.

### What is *not* on this list, and why

`Proxy`, `Reflect`, property descriptors, prototype manipulation, realms — §13.
They are refused, they will stay refused, and a checklist that files them beside
`Map` turns one decision into a hundred open items.

## 16. What the checker knew, and the IR dropped

§6 says types are erased: they decide representation and then stop existing.
That is the design, and it is why nearly all of the type surface costs nothing.
But erasure runs in one direction only, and it takes the proofs with it. By the
time a backend could use the fact that a value is one of three integers, nothing
in HIR remembers that anybody ever knew.

This section is the ledger of those facts. Ordered by what was measured, and
the zeros are kept — three of the entries below are things that looked obvious
and were worth nothing, which is the only reason to write them down.

The question to ask of every new pass: **what did the checker know that we
dropped?**

### Two kinds of fact, and only one of them is cheap

**Stated.** TypeScript, or the runtime header, already says it. Recovering it
is carriage, not analysis: find where the fact is discarded and stop discarding
it. Both of this week's wins were this shape, and both were small changes.

**Derived.** Nothing states it and an analysis has to prove it. That `Ball.x`
fits an `int32` is true and no part of the program says so — §7's note on the
awfy family is this shape, and it is still open.

The distinction is the whole planning value of this section. The first kind is
bounded work with a known answer. The second is a research problem, and filing
the two together turns a short list into a long one.

### What it was worth

| fact | where it was being dropped | measured |
|---|---|---|
| a length is a `uint32_t` | the header states it; `OpKind::Length` was typed `f64`, so a counter bounded by one was not provably an `i32` | **4.0×**. `elementwise` went 4.95× C++ to 1.25×, and it moved `accumulate`, `awfy-nbody` and `awfy-sieve` with it. Both backends |
| a typed-array element is a `u8` | the element type was known and the value still travelled through a `double` on the way to an `i32` | the generated C went from **74 implicit conversions to 0**; `simplify::fold_conversions` collapses the detour where it is exact |
| `readonly` on a field | `Field::readonly` is carried all the way from the frontend | **0**, twice over. `!invariant.load` is the wrong encoding — it licenses "same value wherever the location is dereferenceable", which folds a post-construction load into a pre-construction one. And no benchmark has a `readonly` field, so there is nothing to measure even if the encoding were right |
| an array that cannot grow | `arrays_can_grow` is **one boolean for the whole program**: a single `push` anywhere disables exact-length reasoning everywhere | **0**, and not for the reason expected. Adding an unrelated exported `push` to `elementwise` changed `scale`'s IR *not at all* — its array is a parameter, and `allocated_length_is_exact` already declines for parameters. The cliff is real and no case has yet fallen off it |

Two more zeros belong here for the same reason, from §7's attribute work:
`captures(none)` was worth nothing once `memory(read)` was in place, and the
allocator attributes (`malloc`, `returns_nonnull`) were worth nothing at all.

**A fifth, from the native lane on 2026-09-15, and the cheapest kind.** A
binding's `@ntsHeader` says which headers describe a declaration. `schema.rs`
walked up the declaration's parents to *find* that module and returned a
`bool` — so every program carried every `@ntsHeader` in the snapshot, reached or
not. `native-stat` compiled with seven headers and used one.

The fact was not merely available; it had already been computed and was being
thrown away at the return. Carrying it is a `NodeId` on `Naming::Tagged` and one
on `native::Function`, and the header set becomes the union over the records and
calls a program holds. Measured: **seven headers to one** for `native-stat`,
zero for `native-callback`, and every witness assertion count unchanged —
8/40/38/14/16/3/16/10 before and after, which is what separates "fewer headers"
from "fewer checks".

It belongs in this section rather than in §7 because it is the **stated** kind in
its purest form: nobody had to prove anything, and the whole change is finding
the line where a computed fact is discarded and not discarding it. The version
that *derived* the same set — guessing which modules a program reaches from node
kinds — passed sixteen examples and every test while emptying a witness.

### A search for the stated kind, and its first result

The header-provenance entry above has a shape that can be looked for rather than
stumbled on: **a function that locates something and returns a `bool`**, throwing
away the identity it just found. `declares_a_header` walked a declaration's
parents to find the module carrying `@ntsHeader` and answered yes or no.

    fn <name>(..) -> bool          with `.find(`, `.find_map(`, `.position(`
                                   or `while let Some` in its body

26 functions in `hir/` match, on 2026-09-15. **Sampled, not exhausted, and the
sample is a zero so far**: `counted_from` locates a defining op the caller
already holds, and most of the rest are genuine predicates — a question whose
honest answer *is* yes or no. The identity only matters where something
downstream would use it, which is the same test §16 applies to every fact here.

Two cautions, both paid for. The first pass matched `-> bool` anywhere in the
signature and reported `enclosing` — whose return type is `Result<usize, _>` and
whose *closure parameter* is `-> bool`. And the list is a floor: a function that
locates something through a helper rather than a `.find(` in its own body does
not match.

So this is recorded as an instrument with a null result rather than as a
finding. It cost one search to build and it found the shape that was already
known; what it is for is the next one.

### The traversal, 2026-09-15: asking every pass what it was told

The entry above is one fact found by one instrument. This is the sweep the
section is named for, and its first result is structural rather than a row.

**No pass can drop a checker fact, because no pass sees one.** 36 of the 40
files in `compiler/core/src/hir/` contain no reference to `snapshot` at all.
The four that do are `lower.rs` (662 references), `generics.rs` (50),
`native.rs` (23) and `mod.rs` (22), plus one in `presence.rs`. So "what did this
pass discard" has exactly one address: whatever `lower.rs` does not write into
HIR is gone, and `own`, `escape`, `rc`, `facts`, `loops`, `elements` and the
rest cannot recover it however clever they get. That is the erasure boundary
working as designed, and it means this section's question is always about one
file.

Then the fields, top down. **All 14 top-level snapshot fields have a reader** in
core or codegen, so nothing is dropped at the entrance. The losses, if any, are
inside the records.

#### What was found: a fact that was never stated

`SignatureRecord::is_async` was the constant `false`. One construction site
(`decompose.rs`), and it wrote the literal, because the checker reports `async`
on a *declaration* and never on a signature — which that site's own comment
said. Three readers treated it as real:

| reader | what it believed | what it got |
|---|---|---|
| `signature_name` | an `A` in the layout name marking an async signature — its doc says so | no `A` has ever been emitted. **0 `FnA` names** in the C of 40 examples, both before and after |
| `native.rs` | a refusal: `foreign function ... with a generic, async, or constructor signature` | the async disjunct could not fire |
| `signature_key` | a component of the identity key for a function type | a constant, contributing nothing |

**Populating it would have been the bug.** `async function f(): Promise<T>` and
`function f(): Promise<T>` are *one type* to the checker — both assign to a
`() => Promise<T>` slot, checked — so an `A` would give a single type two layout
names, and for a function type the name **is** its identity. That is the hazard
recorded four lines below `signature_name` itself, where `Ctor_Error` and `Fn…`
merged and emitted `normalizeString`'s function parameter with the type of the
`Error` constructor.

And the second reader's case cannot be written at all: a foreign function is an
ambient declaration, and TypeScript rejects the modifier there — **TS1040,
`'async' modifier cannot be used in an ambient context`**, verified with the
same file minus the keyword, which typechecks. So the guard promised to refuse
something the language forbids, using a flag that was always false.

Removed rather than populated, `SCHEMA_VERSION` 14 → 15, and the absence is
documented on `SignatureRecord` so it does not come back. **The artifact was
diffed against the unchanged build, which is what this file requires of a change
that makes something smaller: 40 of 40 examples emit byte-identical
`program.c`.** The instrument is not vacuous — 93 `Fn…__…` names appear in that
output, so `signature_name` is exercised; it simply never had an `A` to print.

#### What was checked and was not a loss

The zeros, kept because they are the point. Each cost a probe with a control arm.

| looked like a discard | why it is not |
|---|---|
| `TypeKind::Conditional`, `IndexedAccess`, `TemplateLiteral` — **one** mention each in all of core, and that mention is the function that names a type in a refusal | the checker resolves them before the snapshot. `Id<string>` where `type Id<T> = T extends string ? number : boolean`, `Box["x"]`, and `` `a${"b"}` `` emit signatures **byte-identical** to `number`, `number` and `"ab"` written literally. Those variants are reached only when genuinely deferred, where refusing is right |
| `TypeKind::Structured` — the schema's *own* documented discard: "a structured type the checker resolved but this snapshot has not decomposed into members yet" | **0 of 720 distinct named things** across `stream`, `fs`, `http` and `net`, 168 root messages, 2026-09-15. Historically it was 344 occurrences across 36 sites; the `NON_PRIMITIVE` handling closed it. The instrument was validated before the zero was believed: the same census surfaces `a union of` 25 times, `an array of` 27, `an intersection` 7 |
| `decompose.rs` leaves a placeholder when a type's arguments mention a type parameter, on the stated ground that "only instantiations are ever lowered" | **the precondition was checked rather than trusted, and holds.** `g<T>(b: Box<T>): T` reading `b.v` compiles, and emits the same signature as the concrete `g(b: Box<number>)`. Six of the eight give-up sites in that file are defensive — they fire only when an RPC returns nothing — and the other two are policy with a reason |

#### The opposite failure: a fact carried and never read

`SignatureRecord::type_predicate` — what `x is T` narrows — has **zero** readers
in core and codegen, and `type_predicate_of_signature` is an RPC to tsgo issued
*unconditionally for every signature decomposed*. Its schema doc says what it is
for: "that is what turns a virtual dispatch into a direct call".

It is not a loss. Narrowing already arrives through `node_types`, which carries
the checker's narrowed type at the access node: a user-defined guard and an
inline discriminant check compile the same, with no diagnostic from either. So
the predicate is redundant carriage rather than a dropped fact — **left in place
and recorded here as a cost, not removed**, because unlike `is_async` the data
is true and the question is only whether the round trip is worth it. What would
settle it is a build with the call removed, timed; that has not been done.

### What is still on the table

Each row is a fact TypeScript states today and HIR does not carry. None of them
is measured, so none is a promise — the `readonly` row above is what an obvious
one is worth when nothing exercises it. **Build the case that would show it
before building the pass.**

| what TypeScript states | what it would license | what would falsify it |
|---|---|---|
| **definite assignment** — `strictPropertyInitialization` proves every field is written before it is read | `hir::fields` joins in `Facts::constant(0.0)` "because that is what the allocator leaves", and its own comment says avoiding it needs a definite-assignment analysis. The checker has already done that analysis | soundness first: `!` assertions and a non-strict config both opt out, so it is conditional on a flag we would have to read. Then a case where the join is what widens a field |
| ~~**literal and union-of-literal types**~~ — **audited, and half of it is already done.** The *range* reaches the backend: an exported `f(d: 0 \| 1 \| 2 \| 3)` indexing a four-element array emits `array.get unchecked`, where the same function taking `number` emits a checked one. Same shape, same array, one difference — so the check is removed by the declared type and nothing else. What is **not** used is the *representation*: that parameter is still `param 0 : f64`, a double holding one of four small integers | the remaining half is a narrower parameter, and it is not free — a public signature is an ABI, so `number` being `f64` is a promise to the next caller. It is available to a *non-exported* function, where the whole call graph is visible |
| **an exhaustive discriminated union** — **unblocked 2026-09-11.** `switch (s.kind)` over `{kind:"circle";r} \| {kind:"square";side}` was refused outright at the lowering: "`kind` on a union, whose members lay their fields out differently". Reading the discriminant lowers now, because every member declares it first — which is what makes the union discriminated. Record 0289 | Price the fact now that the construct compiles on C and LLVM; the JVM half is with that lane |
| ~~**`as const`**~~ — **audited: worth nothing today.** `[10,20,30,40] as const` and the same array without it emit identical HIR — two checked `array.get` and two `array.len` apiece. Deep readonly and the fixed length are both discarded | — |
| ~~**a counted loop over a *global* array keeps its bounds checks**~~ — **found by the control above rather than looked for, and fixed.** Each mention of a module-level `A` is its own `global.get`, so `A.length` bounded `%7` while `A[i]` indexed `%12` and the relationship never matched. Two loads of one global are two values and one array; `same_array` says so while nothing writes that global. Both accesses are `array.get unchecked` now | **its worth is unmeasured, and that is this section's own warning pointed at itself.** No benchmark has a module-level array -- zero of them -- so the check is gone and nothing prices it. `examples/module-state` does have one, so it is *correct* (91 of 91 agree with node); it is not *measured*. A lookup table at module scope is a common real shape and the case is worth adding |
| **`enum`** — a member is one of N known constants | the same range fact as literal types, on a construct real code actually uses | §6 marks `enum` ✅ but the corpus refuses four of them. This is Lane 1 work before it is Lane 2 work |
| ~~**non-nullability**~~ — **audited: already done.** A function reading `b.value` through a `Box` emits **zero** null tests; the same read through a `Box \| null` emits four. The type removes it outright, so there is no check left for a `!nonnull` to help | nothing. Kept as a row because the next person to look at this list should not spend an afternoon confirming it |
| **`readonly T[]` per array** | the per-array answer to `arrays_can_grow`'s whole-program boolean | the row above: find the case that falls off the cliff first |
| **which array a `number[]` is** — `number[]`, `Float64Array` and `Int32Array` are three types TypeScript keeps apart and this compiler represents as one | `Array.isArray` on a value whose type is open, at **32 sites** in `runtime/node`. Node answers `true` for a `number[]` and `false` for a `Float64Array`, and both are `Managed(Array(Float { bits: 64 }))` here — one `nts_desc_double`, one address | **the runtime test is not the missing piece, and that was measured rather than assumed.** It was built: a reference tag, a header, and a descriptor `kind`, which separates an array from an object today. Then a two-line fixture emitted one descriptor for a `number[]` and a `Float64Array` in the same program, and the answer they need is different. Nor does the element type separate them — `elements` narrows an integer-only `number[]` to `i32`, which is also `Int32Array`. Closing it means carrying the distinction into `ManagedType::Array`, which is a representation change and not a carriage one |

### `instanceof` is where the two lanes meet

`erasure.rs` reads `INSTANCEOF_KEYWORD` to recognise that `x instanceof C`
narrows an erased value — a real precision gain, on the compiler's single
largest representation cost. The constant was **wrong**: 104, which is `new`;
`instanceof` is 103. Every classification it made was of the wrong keyword.

Fixing it changed no measurement, and the reason is the useful part. There is
no example that uses `instanceof`, because `instanceof` on a class is refused
before the erasure analysis ever runs — "a class used as a value is not
supported by this lowering yet", §15's largest single row at 68 sites.

So a silent precision loss sat behind a refusal, where no test could reach it
and no benchmark could price it. That is the general hazard with this section:
**a Lane 2 fact is worth zero until the Lane 1 construct that produces it
lowers.** Check that a construct compiles before pricing what its type could
buy.

### The one that is not stated, and what it is actually made of

This entry was written twice. The first version said `awfy-bounce`'s 1.53× was
`Ball` carrying four `number` fields that hold `int32` values, gave a
flow-sensitive fixpoint that would prove it, and was wrong about the cause. It
is kept here as written and then corrected, because the correction is the more
useful half.

The claim was testable without writing the analysis: state the conclusion in
the source and measure. A throwaway copy of `bounce.ts` with every field store
written through `| 0` makes `hir::fields` narrow all four to `i32` — checked in
the HIR, and the runner's checksum confirmed the program was unchanged. It is
not checked in: `| 0` is not what a TypeScript programmer writes, and a
diagnostic that lives in the benchmark directory eventually gets read as one of
the benchmarks.

| | nts (C) | vs C++ |
|---|---:|---:|
| `awfy-bounce`, fields `f64` | 6.37 us | 1.55× |
| `awfy-bounce-int`, fields `i32` | 5.92 us | 1.43× |

**7%.** Real, and not the gap. So the reference was worth reading rather than
summarising: C++ `Ball` is four `int32_t` — 16 bytes, not the 40 first claimed
here — and the hundred of them are a `std::array<Ball, 100>` **inline on the
stack**. nts allocates a hundred separate objects, each behind a 24-byte
header, reached through an array of pointers.

Compiling the reference four ways separates the two costs:

| | | |
|---|---:|---|
| inline `int32`, as the reference is written | 5.75 us | |
| inline `double` | 6.46 us | the field width costs **1.12×** |
| boxed `int32` | 8.77 us | the boxing costs **1.52×** |
| boxed `double` | 10.81 us | together, 1.88× |

Boxing is the cause and field width is a rounding error beside it. The numbers
reconcile: scaled into this harness nts sits at about 8.9us, which is *boxed
int32* almost exactly — the bump allocator already lays the hundred objects
down contiguously, so what is left is the header spacing them apart and the
pointer array reaching them.

**What that makes the work.** Not a range fixpoint. An array whose element type
is a class, whose objects never escape the function that fills it, and which is
never assigned an element from elsewhere, can hold the *fields* contiguously
rather than a hundred pointers to a hundred headers. `hir::escape` already
computes the escape half; the element type is exactly what `Ball[]` states.
This is the same shape as every other entry in this section — a fact the
checker states, dropped on the way to a layout — and it is worth more than
every field-narrowing entry above it put together.

Two lessons, both paid for. **Read the reference, do not summarise it**: the
40-byte figure was invented and the `std::array` was the whole answer, sitting
in a header nobody had opened. And **price a fix by stating its conclusion in
the source before building the analysis that would derive it** — `| 0` cost one
file and refuted a week of work.

### What a representation costs when no analysis can remove it

`fib` is the row where this section runs out. It sits at **1.70×** C++, the
second-widest gap in the table, and none of it is a dropped fact.

`fib#whole(n: i32)` already exists — the *parameter* narrows, because `number`
carrying a whole value is exactly what the `#whole` specialization proves. The
**return** is still `f64`, so every base case emits a `convert %0 : f64` and the
combine is a double add where the C++ reference has an integer one.

Compiling the reference twice — once as written, once in nts's representation —
prices that exactly:

| | `fib(27)` | vs the reference |
|---|---:|---:|
| C++ `int64_t` throughout, as the reference is written | 301.96 us | 1.00× |
| C++ with an `int32_t` parameter and a `double` result | 485.93 us | **1.61×** |
| nts (LLVM) | 517.40 us | 1.71× |

So **1.61× of the 1.70× is the representation**, and 6.5% is everything this
compiler does differently from clang given the same one. There is no analysis
to write: narrowing the *return* needs `fib(n) < 2^31`, which needs a bound on
`n`, which the exported signature destroys — and the reference's `volatile`
denies clang the same bound, so this is not a constant-folding advantage either.

Worth keeping as the section's own ceiling. Three of the four zeros above were
facts that turned out not to be there; this is a gap that is real, measured, and
still not a fact anybody dropped.
