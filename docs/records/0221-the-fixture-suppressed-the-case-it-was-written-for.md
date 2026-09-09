# The fixture suppressed the case it was written for

`0220` said what the element kind had to be and why the read could not be built
without it. It is built: `NtsDescriptor` carries `element`, `nts_array_element`
reads a slot through it, and `indexing an array of any` is a guard rather than a
blocker. Nine functions agree with node end to end, eighteen runtime checks
pass, 76 of 76 fixtures are as expected.

None of that is the finding. The finding is that the first fixture I wrote to
prove the eight-byte case **reported six green checks while testing it zero
times**, and nothing in the fixture could have said so.

## What happened

`hir::elements` is keyed by element *type*, and its own module comment says the
consequence plainly: "one array of fractions anywhere in a program costs every
`number[]` in it the narrowing". I read that sentence, understood it, and then
wrote a single fixture containing

    doubles()  const xs = [1.5, 2.5, 3.5];
    wide()     const xs = [4294967296, 8589934592, 4503599627370495];

The join of those two is not whole, so `width_for` declines, so **both** arrays
emit `nts_desc_double`. The fixture exercised the `NTS_ARRAY_FLOAT` arm twice
and `NTS_ARRAY_INT` never. Every check passed. The descriptors printed at the
top of the file said `double[]` and I had already stopped reading them, because
the emission had been correct for an hour.

Split one function per program, `wide()` emits `nts_desc_int64_t` and the case
is reached. That is the whole difference, and it is invisible from inside the
fixture.

## Three probes said the ambiguity was theoretical, and all three were wrong

Before that, I nearly recorded something worse. Asking whether an integer array
is emitted at all, my first three attempts all produced `double[]`, each for a
different reason:

    const xs = [1, 2, 3]                     module scope   stored_into_a_global
    function f() { const xs = [...]; ... }   acc += xs[i]   read_into_floating_point
    the combined fixture                     a fraction     the shared element type

Three disqualifiers, three `double[]`, and the obvious reading is that
`Array(Int)` is unreachable and `0220`'s eight-byte ambiguity is a story about
code nobody writes. `benches/cases/dispatch` emits `nts_desc_int32_t`, which is
the counter-example, and it is in the tree — the module comment names it as the
motivating case.

The correct instrument was a **pair**: the same program with and without the
thing suspected of suppressing it. `p1` and `p2` differ by whether the array is
also passed to the dynamic read, and both emit `int64_t[]`, which is what said
the read is reached *and* the narrowing survives it.

## What the field cost, against what I predicted it would

`0220` estimated one field and two emitter sites, and I counted fifteen runtime
literals to go with them. The real count:

    runtime/c/nts_runtime.c        15   mine
    runtime/c/tests/*.c            10   mine, and not in my count at all
    compiler/codegen/c/src/emit.rs  2   mine
    runtime/node                    3   not mine

The ten I missed were caught by `-Wall -Wextra -Werror`, which is exactly the
argument the struct's own comment makes for not giving the field a default:
"adding a slot kind costs one line in every descriptor and cannot be forgotten
in one". It was forgotten in ten, and the compiler said so before any test ran.

The three in `runtime/node` are built without `-Werror`, so their literals end
early and the field is zero. That is `NTS_ARRAY_UNKNOWN`, which refuses. It is
the right failure and it is a real gap: `nts_node_desc_double`,
`nts_node_desc_value` and `nts_zlib_desc_u8` cannot be dynamically indexed until
someone adds one line to each.

## The kind list is wider than what is reachable, on purpose

`0220` said "four or five values". There are six and an unknown, and the extra
is `NTS_ARRAY_UINT` — for a spelling `width_for` never chooses.

Zero has to mean "this runtime predates the field" and nothing else. An element
type the *emitter* forgot to list would also emit zero, and the two are
indistinguishable from outside: both abort, both name the array. So the emitter
is not permitted to produce `NTS_ARRAY_UNKNOWN` at all, and the test that
enforces it enumerates every scalar `c_type` can spell rather than every one
narrowing currently picks. `uint32_t` is in the list because `c_type` can spell
it, not because an array of one exists.

`0220`'s "four bytes is unambiguously `i32`" is still true of what is reachable
today. It is not a property to build a runtime read on top of.

## The write path, which was a third site and read as a second

`0220` said the lowering was "known to two lines". It was three. `element_of`
and `element_access_parts` are the read; the *assignment* lowering calls
`element_access_parts` too, so relaxing its guard silently admitted `xs[i] = v`
on a receiver with no element type.

Reading through a descriptor and writing through one are not the same feature.
A read has a slot and asks what is in it; a write has a value whose static type
need not be the slot's, and narrowing a double into an `int64_t[]` is a
conversion with no place to be decided. It refuses by name.

## Two sabotages, and one of them proved nothing the first time

The runtime suite and the example were both controlled by making the runtime
guess from width alone — `size == 8 ? NTS_ARRAY_FLOAT : element`. The runtime
suite failed three checks. The example failed zero.

`nts check` embeds the runtime with `include_str!`, so `target/release/nts`
carries whatever `nts_runtime.c` said when the CLI was *built*. Editing the C
and re-running the gate measures the old runtime and reports agreement. Rebuilt,
the same sabotage disagrees on `wide`, `widest` and `text`.

`text` is the one I did not predict. `nts_desc_ref` is `sizeof(void *)`, so a
**reference** array is the second eight-byte descriptor — `references` separates
it and always did, which is why it was never part of the ambiguity, but it means
width alone is less discriminating than `0220` credited.

## What is closed

`indexing an array of any` was the widest root on the board. The chain `0220`
traces — `errors.ts:533` to `inspectValueWithin` to `StringDecoder#constructor`,
and the sixteen validators in `os`'s cone — no longer stops here. Whether any
module goes green is a different question and `0216` is the reason not to
predict it from a root count: clearing a head reveals the next refusal in the
same function, and this is one refusal of several in most of those cones.

The measurement is a separate step and belongs in the record that makes it, not
in this one.
