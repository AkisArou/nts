# Four modules, a flag, and a property name

Three defects, none of them found by the thing that was supposed to find them.
One was mine and live; two were found by another lane reading my code. All three
have the same shape: **a check that could not fail, or a comparison where both
sides shared an assumption.**

## The needle whose type nobody checked

`validateOneOf(value: unknown, name: string, oneOf: Choices)` calls
`oneOf.includes(value)`. The lowering picks the helper from the *array's*
element type alone, so a `string[]` chose `nts_array_includes_str` and handed
`const NtsString *` an `NtsValue`.

    console, fs, readline, util
    program.c:17461: passing 'NtsValue' to parameter of incompatible type 'const NtsString *'

The bug is older than the day it appeared. It became reachable the hour
`validateOneOf` first compiled -- which happened because two lanes each landed
half of the `inspectValue` chain within an hour of each other. Nothing in the
lowering checks an extern's arguments against `hir::runtime`'s signature table,
because most of that table's entries are `None`. **The C compiler is the only
thing that noticed, and it noticed twenty minutes into a gate run.**

The repair that would have been wrong is unerasing the needle. An `unknown` that
is not a string is not an error here: `SameValueZero` says it is absent from an
array of strings, and node answers `false`. Unerasing aborts. So
`nts_array_includes_str_value` reads the tag and answers "not found", and
`nts_array_index_of_str_value` answers `-1`.

**The suite for it is in `runtime/c/tests/needles.c` and not in `examples/`,
because the shape cannot be written as a fixture.** TypeScript will not
typecheck `strings.includes(u)` without a cast, and `as string` unerases *before*
the call -- so the first version of the example passed while testing nothing, and
the second segfaulted for an unrelated reason. Only the generic instantiation
node uses produces an erased needle against a string array, and a generic
function is refused in a standalone fixture. Most of the suite's needles are
therefore not strings: a number, a boolean, `undefined`, `null`, and an object,
which is the tag that shares a slot with a string and so is the one a check on
the *payload* would let through. Controlled by deleting the tag test, which
fails it.

## A double call I introduced and the C caught

Moving the argument lowering above the helper choice left the original loop in
place, so `["a","b"].includes(side())` called `side()` twice. Seen first in the
emitted C as

    erase(v0, v1);
    v5 = erase(v0, v1);

and confirmed in the HIR: **1 call on the numeric path, 2 on the reference
path.** A `str.replace(old, new, 1)` over a file with two near-identical blocks
put the restoration in the wrong one, and the build error it produced pointed at
the *other* function -- so the fix looked right and landed in the wrong place.

## A flag that changed the answer and agreed with itself

`nts emit-{llvm,jvm} --entry work` did not root `module#init`. The no-`--entry`
arm has always known module evaluation is a root; the named arm dropped it, and
`nts-bench` pushes it back at `main.rs:1799` with a comment saying why.

The JVM lane found it: `symbol-keyed-map --entry work` printed 32768 against
node's 10240, because five module-level `const` symbols stayed null, five
distinct map keys collapsed into one, and every lookup hit it. 24 of the 60 bench
cases have a `module#init`.

**Their ART sweep had been reporting `agree` on it for two days**, truthfully:
`java` and `dalvikvm` were bit-identical on a program that was not the
benchmark. Two runtimes, one artefact -- and identical is what a wrong program
is too.

`emit-c` is a separate case and is left alone here: it hardcodes
`[MODULE_INIT]` and ignores `--entry` entirely, so the flag does nothing for that
backend rather than doing the wrong thing.

## A property name C cannot spell

    class Holder { "a b": number = 1 }
    ->  int32_t a b;
    program.c:8:14: error: expected ';' at end of declaration list

`c_identifier`'s first branch is injective and its comment says so deliberately.
But that branch runs only when the name contains one of five *qualifiers*, and a
TypeScript property may carry any character at all, so `"a b"` took the `else`
and came back verbatim -- with `_Static_assert(offsetof(NtsObj_Holder, a b))`
behind it. An `uncompilable C` row, and that row is a hard zero.

Found by the JVM lane, who had the identical defect in `jvm_member_name` and
fixed it the same way: a hand-listed `match` of six characters that a ratchet
refuted on its first run, twenty-two characters short. **A list can be short by
one; a predicate cannot.**

Refused rather than escaped, for the reason their lane gave: the catch-all maps
every other character to `_`, which is not injective -- `a b` and `a+b` become
one C name -- and an injective mangling costs every generated name its
readability for a construct no program in this tree writes.

**Refusing the field was not enough, and that mistake is worth keeping.** The
`_Static_assert(offsetof(...))` lines are emitted from `layout.fields` further
down, so skipping the field left a struct two members short with two asserts
still naming them. `emit.rs` already carries a comment about that exact shape --
*"a struct missing a field the reference map still points at is not a smaller
object, it is a wrong one"* -- and the first attempt reproduced it through a
different door. The whole struct is refused now.

## And the fixture that reported FIXED for a construct that always refuses

`property-name-with-no-c-spelling` first expected the diagnostic without the
`emit-c --napi ->` prefix. Without it the harness runs `nts hir`, which is the
raw lowering and never reaches the C backend, so the refusal could not appear and
the fixture read **FIXED**.

That is the fourth time today a guard was wrong in the permissive direction: a
test enumerating twelve of thirteen variants by hand, two `cross` calls handed an
empty class set, a `lacks-addon` on a word the emitter writes in its own prose,
and now an expectation pointed at a pass that does not run. None of them
failed. All of them said yes.
