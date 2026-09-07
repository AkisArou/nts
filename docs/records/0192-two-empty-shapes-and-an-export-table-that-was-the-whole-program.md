# 0192 — Two empty shapes, and an export table that was the whole program

The compiled-addon axis was measured for the first time this week and came back
0 of 22: eighteen modules whose generated C clang would not accept, and four
that linked and exported the wrong things. Two of the defects behind that are
closed here. Neither was found by looking at the compiler.

## Three guards, three families, and the three pairs nobody guarded

`Layout::same_shape` decides whether two layouts are one. Three families of
layout defeat it, each deliberately:

  - a provided error class, whose fields are `message` and `name` and are the
    same for all four;
  - a function type, which is a signature rather than a class and so has no
    fields, no methods and no base;
  - a class used as a value, "an object that exists to have an address".

Record 0096 predicted the family and said why: shape cannot answer a nominal
question about a shape with nothing in it. The guard against it was then written
three times, once per family as each was discovered, and every one of them asked
whether **both** sides were in that family:

    let two_errors     = is_error(&known.name)             && is_error(&layout.name)             && ...
    let two_signatures = is_signature_name(&known.name)    && is_signature_name(&layout.name)    && ...
    let two_tokens     = is_constructor_name(&known.name)  && is_constructor_name(&layout.name)  && ...

Three same-family guards. There are three *cross*-family pairs and none of them
was covered, and node's `path` found one:

    node:   function normalizeString(path, allowAboveRoot, separator, isPathSeparator)
    ours:   NtsString *normalizeString(NtsString *, bool, NtsString *, NtsObj_Ctor_Error *)

The fourth parameter is a function. It was emitted with the type of the `Error`
constructor, because the empty token layout and the empty signature layout
merged. `nts_vtable_NtsObj_Ctor_Error` was then the only vtable in the entire
program, naming a `Ctor_Error__call` that no pass ever emits, and clang said so.

That clang error is the *fortunate* case. A signature layout is never
instantiated, so it never gets a descriptor and never gets a vtable; the merge
became visible only because a constructor token **is** instantiated — there is a
`nts_fnval_NtsObj_Ctor_Error` singleton — so the merged layout acquired a
descriptor and the dangling slot went into it. The same merge in a program
without that slot is a parameter with the wrong type and nothing said anywhere.

The fix is one predicate over both sides rather than three over one:

    fn nominal_name(name) = is_error(name) || is_signature_name(name) || is_constructor_name(name)

    let named_apart = known.name != layout.name
        && (nominal_name(&known.name) || nominal_name(&layout.name));

A/B on the 22-module corpus, same source, two binaries, nothing else moved:
`path` 1 clang error to 0, `async_hooks` 2 to 1, `zlib` 16 to 15, every other
module unchanged.

**A prediction, made independently by two sessions, and false.** The largest
clang class is 57 `no member named 'X' in 'NtsObj_Y'`, with `NtsObj_Context`
missing four members and a size assertion failing beside it. Both of us read
that as this bug seen from the other side. It is the *opposite* bug — two
layouts named `Context` each emitting `struct NtsObj_Context`, which is
over-separation — and the merge fix moved none of it. The size assertion was
doing exactly what it was added for.

## `exported` is a modifier, and a modifier does not know what file it is in

The four addons that linked all exported the same four foreign names:
`utf8Length`, `normalizeEncodingName`, `byteLengthIn`, `revokeObjectURL`. The
last three are private helpers inside `node:buffer`. A `string_decoder` addon
exporting a Blob URL revoker is not a subtle symptom.

`Func::exported` is set from the `export` keyword. That is all it can mean, and
it is the right meaning for its other job — marking a reachability root, which a
helper reached by an import genuinely is. The N-API backend was using it as an
export *list*, so the addon published every `export` in the whole linked program.

What was missing is the other half of the question — whose surface is this? —
and `evaluation_order` already computes the answer and throws it away. Its
comment even says why that hurts:

> the frontend does not know the product: a library's surface is its exports and
> an executable's is its entry, and that choice is made after lowering

So the entry modules' export list is now recorded on the program.

### Two wrong turns, both properties of the frontend rather than of the fix

**Filtering by declaring file gives `path` an empty table.** `path/src/main.ts`
is `export * from "./posix.ts"` and declares almost nothing. Nearly every
`runtime/node` module is a barrel, so "declared in the entry" is the wrong
question and "exported by the entry" is the right one. One `aliased` hop fixes
it, because the frontend has already collapsed re-export chains.

**Stripping the module qualifier off the emitted name would have been silently
wrong.** `posix.ts` and `win32.ts` both declare `basename`, emitted as
`basename@posix` and `basename@win32`. Publishing both under `basename` sets the
property twice and lets the second win — a green build and a wrong artifact,
which is the failure the qualified-name scheme exists to prevent and which
stripping the qualifier reintroduces at the last step. So the pair is carried
explicitly: emitted name and published name, neither derived from the other.

    os               hostname type release version machine arch platform homedir tmpdir endianness uptime
    path             toNamespacedPath
    querystring      escape
    string_decoder   (empty)
    buffer           (empty)

`path` publishing `toNamespacedPath` is the proof both halves work: declared in
`posix.ts`, emitted as `toNamespacedPath@posix`, reached through `export *`,
published under its plain name.

**The empty tables are the honest answer.** `string_decoder` exports a class and
`buffer` exports classes; the four names they carried were never theirs. `os`'s
absent twelve are absent for two separable reasons now visible rather than
mixed: `cpus`, `networkInterfaces`, `userInfo` and `loadavg` return objects or
arrays that cannot cross the ABI, and `totalmem`, `freemem` and
`availableParallelism` are `export const totalmem = nts_os_totalmem` — a const
bound to a native function, never a `Func`, and so never in the table to filter.

## What to take

Two guards written for two instances of one rule will not cover the third, and
the third is not a new rule. Each of `two_errors`, `two_signatures` and
`two_tokens` was correct, added with a real failure behind it, and none of them
was the invariant — which is that a layout whose *name* is its identity does not
merge with a differently-named layout, whatever the other one is. The general
statement was available at the first instance and record 0096 very nearly makes
it.

And a flag answers the question it was defined for. `exported` was asked a
second question it has no way to answer, in a different backend, and returned
something for it.
