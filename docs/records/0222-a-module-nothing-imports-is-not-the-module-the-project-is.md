# A module nothing imports is not the module the project is

`hir::lower::public_api` decides whose exports an addon publishes, and it
decided by asking which modules nothing imports. That is a guess, it is wrong
in two different shapes, and both were silent.

    fs      0 published   0 declined   303 exports, no line about any of them
    util    2 published   1 declined   and the 2 are not `node:util` exports

After naming root files:

    fs      1 published  105 declined
    util    1 published   29 declined

Six other modules -- `os`, `path`, `punycode`, `process`, `string_decoder`,
`buffer` -- are unchanged to the export, which is what says the change is the
two modules and not the rule.

## The two shapes

**A cycle.** `fs/src/utf8-stream.ts` imports `openSync`, `writeSync`,
`mkdirSync` and `fsyncSync` from `fs/src/main.ts`; `main.ts:158` re-exports
`Utf8Stream` back. Both are therefore "imported", so neither is an entry, so
the addon has no export list at all -- not an empty publication section, no
publication section, and no decline naming any of the 303.

**A one-way back edge from an orphan.** `util/src/width.ts` imports
`stripVTControlCharacters` from `main.ts`, and nothing in `util` imports
`width.ts`. So `main.ts` is imported and `width.ts` is not, and the orphan wins.
Its three exports are `getStringWidth`, `isFullWidthCodePoint` and
`isZeroWidthCodePoint`; the addon published the last two.

**`node:util` has neither.** This is the part worth keeping: the failure was not
that a surface went missing, it was that a *wrong* surface was published, and
every check that asks "does the module export something" agreed with it. It now
publishes `toUSVString`, which node has.

## Why no rule over the import graph works

Two candidates, each of which fixes one case and breaks another:

- *Not imported from outside my own cycle.* Answers `fs`, whose two modules are
  a real cycle. Leaves `util`, whose back edge is one-way.
- *An importer that is itself a root does not disqualify.* Answers `util`.
  Makes every `posix.ts` an entry, because `path/src/main.ts` is a root and
  imports it.

The fact that `main.ts` is the module and `width.ts` is a helper is not in the
type graph. TypeScript has a place to put it -- `files` names root files, and
`include` names what is in the program -- and the twenty-two module tsconfigs
used only the second.

The Node lane added `"files": ["src/main.ts"]` to all of them, and the reading
matters: `include` still governs, so the union is unchanged, `width.ts` is still
typechecked, and nothing was traded for the entry selection. The alternative --
`files` with `include: []` -- would have dropped `width.ts` from the program
entirely, which is a real loss for code ported ahead of its caller, and they
declined to do it before I had said which reading I meant.

## What survives when nothing is named

Not every project names roots, so the fallback stays, and what changed is that
it now says what it cost. One line, with a count and the largest few modules --
not one line per module, because with no `files` array *every helper a project
has* is excluded by this rule working correctly, and a project with thirty of
them would get thirty lines. The count is the signal.

## Three instrument failures, and the middle one caused work

**A count of zero from a command that emits nothing.** The first check of the
fix ran `emit-c --napi` without `--out` and counted declines: zero. `--napi`
alone writes `program.c` to stdout and builds no addon, so there is no
publication pass to decline anything. The number was not "the fix did not work",
it was "you did not ask the question".

**Four sources of ten.** Chasing that zero, I printed the first four source URIs
and found `nts-workspace:////home/akisarou/...` -- absolute machine paths -- and
concluded the workspace normalization does not happen, so a composed URI could
never match. `fs`'s program has **ten** `main.ts` files in it, nine of them
other modules' (`buffer`, `path`, `querystring`, `events`, `string_decoder`,
...), and those are outside the tsconfig's directory so `strip_prefix` correctly
leaves them absolute. The first four I printed were all outside files. `fs`'s
own is `nts-workspace:///src/main.ts`, exactly as composed.

Measured afterwards by putting the composed version back: **it produces the same
105 declines.** The rewrite it caused was not needed.

It is kept, and for a reason that is true rather than the one that motivated it:
matching against the snapshot does not depend on a normalization that only holds
for files under the tsconfig directory, so `"files": ["../shared/main.ts"]` works
and a composed `nts-workspace:///../shared/main.ts` would match nothing. A fix
built on a false diagnosis needs a true reason to stay, and saying which is
which is the difference between a decision and a coincidence.

**And a sample generalised.** Four of ten is the same error as `0221`'s fixture
that tested its case zero times, and as the Node lane's frequency table that
ranked a form at 1,300 when twelve of its thirteen sites were in a shared
dependency. Three shapes, one week: a subset was read as the set.
