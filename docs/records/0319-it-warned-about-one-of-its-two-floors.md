# It warned about one of its two floors

`refusal-census.mjs` ends with this, and it has been right all along:

```text
  N line(s) carried a diagnostic code and could not be read.
  Every one of them is a root missing from the table above, and the table
  is therefore a floor. A parse that drops what it cannot match makes a
  floor look like a total.
```

Somebody thought carefully about the table being incomplete, found a way it
could be, and wrote the warning. The table was incomplete in **two** ways and
the warning covered one.

The other was `roots.slice(0, 25)`. Two hundred and four distinct root messages,
twenty-five printed, nothing said.

## What it cost

I searched the table for `` `done` on a union ``, did not find it, and wrote
into a checked-in fixture:

> `refusal-census.mjs` over 26 modules today has **no row with that message at
> all**, under either wording, so the corpus reach is zero.

The cause was in `internal/errors.ts` the whole time, wearing a different member
name:

```text
internal/errors.ts:1256  `code` on a union one of whose members has no layout
```

The sentence was in a fixture other people read, and I had written it while
correcting *somebody else's* stale figure in the same paragraph.

## Why the existing warning made it worse rather than better

A tool that says nothing about its limits invites you to check. A tool that
names one limit carefully reads as having told you its limits. The parse warning
is specific, technically worded, and appears at the bottom of every run — it is
exactly what a reader uses to calibrate how much to trust the thing above it.

**Partial disclosure is more misleading than none**, because it converts "I do
not know what this leaves out" into "I know what this leaves out". That is the
same trade as a diagnostic's default arm ([[0315]]): splitting it once makes it
a smaller catch-all, and the smaller it gets the more it reads like a cause.

## The two reasons the old quotation could not be checked by searching

Only one of them was the search's fault, and separating them is the useful part.

1. **The table was capped.** My fault to assume, the tool's to not say.
2. **The message had changed.** The fixture quoted `` `done` on a union, whose
   members lay their fields out differently ``; the compiler now says `` `done`
   on a union one of whose members has no layout ``. Same cause, new text. No
   amount of raising the cap finds that, because grepping a census for a quoted
   diagnostic ranks texts and not causes — which is already written down, and
   which I did anyway.

## The fix, and what it does not fix

`--top=` raises the cap, and the run now says how many roots it left out:

```text
  179 more root message(s) not shown, of 204.
  **Absence from this table is not absence from the corpus.**
```

That makes "it is not in the table" mean something. It does not make the table
answer a question about one message — a module's own `nts hir` output is what
settles that, and it is what settled this one.

## The night's shape, for the fourth time

Every one of these was a figure an instrument printed, or declined to print,
that nobody expanded:

- `example-refusals` printed `down from 2 -- edit the table` on every run since
  the commit that earned it, and passed. [[0317]]
- A closure example whose every arm called immediately agreed under both
  implementations of the thing it tested. [[0318]]
- A union probe that agreed on 116 cases because the checker had collapsed it to
  the one arm the program built.
- And this: a ranked list read as a set.

The first three were found by expanding a number. This one was found because a
refusal scrolled past in an unrelated module and I recognised it. That is not a
method, and it is why the cap now prints.
