# The flag that says "module" is zero

`export * as posix from "./posix.ts"` publishes now. `path` exports fifteen
names rather than thirteen, and `path.posix` and `path.win32` are objects with
eleven members each.

    join, both namespaces, 25 argument pairs      50 agree, 0 differ
    win32.parse("C:\\a\\b.txt")                     root "C:\\", dir "C:\\a", base "b.txt"
    node's answer                                 identical

The `win32` half is a real second implementation and not an alias for the first,
which is what that last line is there to say.

## The test that looked obvious and published nothing

A module namespace is a symbol, and `SymbolFlags::MODULE` exists. It is
`SymbolFlags(0)` for both of `path`'s.

Measured rather than assumed after the first version compiled cleanly and
changed nothing: `posix` declares `NodeId(14877)`, `win32` declares
`NodeId(17028)`, and both of those numbers are in `snapshot.modules`' list of
root nodes. The frontend maps tsgo's `MODULE` bit when it sees one, and a
namespace-export symbol arrives without it.

So the test is that the symbol's declaration *is* some module's `root`. That is
not a workaround for a missing flag, it is the stronger statement: a symbol
declared by a module's root node is that module, whatever a flag says. Two facts
already in the snapshot, matched against each other -- no path resolution, no
re-reading of the specifier.

## A namespace is the export table one level down

It used to be all-or-nothing: one member without a wrapper and the whole object
was withheld. That is a rule the top level does not apply to itself. `path`
publishes twelve of its own exports and declines five, and nobody argues it
should therefore publish none.

`path.posix` has eleven members and two absences, `format` and `matchesGlob`,
each named on its own line. Withholding it would have kept `path.win32`
`undefined`, which is what eight of that module's test files dereference before
they reach anything else.

An *empty* namespace is still withheld. A name bound to `{}` answers every
presence check and no call, which is the same wrong-answer shape as a binding
published as `undefined` -- and worse for being harder to see.

## Identity, which the old fixture was right to worry about

Node wires all four slots to two objects, and the repair that builds a fresh
namespace object per access satisfies every name while making
`path.posix.posix === path.posix` false. The wrapper creates one `napi_value`
per namespace in the addon's init and sets it on `exports` once, so `path.posix`
is a property read of a single object.

## The diagnostic I shipped an hour earlier was noise, and the corpus said so

`0222` added a line for modules whose exports the entry inference passed over.
Its guard was "excluded, under the fallback, with exports to lose", and I argued
a one-line summary made that tolerable.

It is not tolerable, and the fixture suite reported it within the hour:

    CHANGED  export-namespace: got: no wrapper for 1 module(s): declare 2
             export(s) that were never considered: src/posix.ts (2, imported
             by src/main.ts)

Nothing was lost. `main.ts` re-exports `posix.ts`'s names and publishes them.
Under the fallback, *every library module in every project* is excluded because
something imports it -- which is the rule working -- so the report fired on the
ordinary case and buried the extraordinary one.

It now fires only for a module inside an import **cycle**, which is the case
where the rule has no answer rather than a wrong one: every member is imported,
so every member is disqualified, and both surfaces vanish. That is `fs`, and it
costs 303 exports.

**And it no longer catches `util`.** `width.ts` imports `main.ts` while
`main.ts` never mentions `width.ts`: no cycle, the rule has an answer, and the
answer is wrong because `width.ts` is an orphan helper that wins on being
unimported. Nothing in the graph distinguishes that from `path`'s `main.ts`
legitimately winning over `posix.ts`. Naming roots is what fixes it; reporting
every excluded module in the hope of catching it reports every helper in every
project.

A diagnostic that fires on the common case is not a weaker diagnostic, it is a
different one, and the difference is whether anybody reads it.

## What it did to the other twenty-one modules

`path` is the only one whose *published* count moves. What moves everywhere else
is the accounting:

    fs      1 published  105 declined  ->  1 / 146
    stream  0 / 28                     ->  0 / 63
    util    1 / 29                     ->  1 / 101
    zlib    0 / 53                     ->  0 / 68
    timers  2 / 27                     ->  2 / 29
    the other seventeen                    identical

Those are not new refusals. They are members that were never named because the
namespace holding them was never enumerated: `util.types.isDate`, `isMap`,
`isSet`, `isWeakMap` and thirty-eight more are real functions of a real node
namespace, and until now the whole of `util.types` was absent with nothing said
about any of it. Publishing partially and naming every absence turns one silent
gap into forty-two lines that each point somewhere.

`punycode` is the control for the other kind of namespace: its `ucs2` is an
object literal rather than a module, it published whole before, and it publishes
whole now -- 6 exports, 0 declines, unchanged. The two forms share an emitter
and only one of them changed.

## What is not carried yet

Value members. `export const sep = "/"` is a global rather than a function and
the wrapper builds a namespace out of wrappers, so `path.sep` publishes and
`path.posix.sep` does not. `win32.sep` is `\` and `posix.sep` is `/`, so it is
one of the few members where the two namespaces differ in a way callers depend
on. It is the next piece and it is a different one.
