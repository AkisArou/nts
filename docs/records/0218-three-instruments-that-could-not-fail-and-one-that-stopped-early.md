# Four instruments that could not fail, and one that fired on nothing

Four defects tonight were found by something other than the check written for
them, and in each case the check had reported success. They are one failure with
four faces, and the faces are worth keeping apart because the fix differs.

## An expectation the harness does not run

`blockers-check.mjs` reads an `// expect:` line and decides from its *form*
which command to run. An expectation carrying `emit-c --napi ->` runs the
emitter; anything else is checked against `hir`. So

    // expect: differential walk disagrees

ran `hir`, found the function lowering perfectly well, and reported the fixture
**FIXED**. It was filed to record a live unsoundness — a declared literal
parameter trusted by the body and unenforced at the boundary — and it spent a
day saying that unsoundness had been repaired.

The same trap took `class-name-shared-by-two-modules` and
`class-name-unique-to-one-module` on their first run, with `nothing refused`,
which `hir` also answers cheerfully. **Three fixtures, one shape: an expectation
whose form silently selects a weaker instrument.**

The harness warns about this in a comment two lines from the parser. I had read
it. Reading it is not the same as checking that *this* expectation is one the
parser recognises, and nothing enforces the difference — an unrecognised form is
not an error, it is a different run.

## A fixture that goes green because the text changed

`heterogeneous-tuple-return` asserted `emits-c NtsObj_Tuple7 * nts_probe_...`.
A change made that emit `NtsHeader *` instead, the fixture flipped to **FIXED**,
and I read the flip as the defect being gone.

It was not. The change made an unspellable type spellable **and unsound**: the
binding builds a two-element `NtsArray` and the compiler wants a struct with two
fields, so agreeing on `NtsHeader *` let a compiled program read struct fields
out of an array header. The clang error the change removed had been doing useful
work.

The fixture's own note says to read a `Tuple7` -> `Tuple8` shift as renumbering
rather than a fix. **The general form is larger than the note: a fixture going
green because the emitted text changed is not the defect being gone**, and
`emits-c` cannot ask whether the value is still correct. Its author chose that
form over `lacks-c` deliberately, to fail loud — and it did fail loud, in the
wrong direction, because loudness was the wrong axis.

## A report that is weaker than it reads

`build-floor.sh` said thirteen node modules "build and load". They did. A shared
object binds lazily, so an undefined function symbol is not an error until
something calls it — every one of those modules would have aborted on first
call, and `nm -D` on the built artifact said so in one line.

Nothing was wrong with the check. It measured what it measured, and the sentence
it printed was true. What made it misleading is that a reader wants "works" and
the check says "loads", and the gap between those is invisible until you read
the artifact with a different tool.

## And the one that stopped early

Two lanes made the same error on the same night in three variants. A ladder of
two rungs decomposed `awfy-queens` into element type and remainder, arithmetic
consistent, pointing at another lane's file; a third rung moved most of it back.
A measurement that ruled out bytecode shape as a cause was written up as "no
cause found". And a 6.3x row was never checked against its reference, because
**6.3x was too big to look like it could be about the reference**.

Mine was the same: I refused a prototype the C backend could not declare, the
diagnostic improved, and I stopped — while the body still emitted the assignment
clang rejects, so the module was no better off. I had fixed the head of the
thing I was looking at, and the thing I was looking at was the message.

## A test whose name was narrower than its assertion

`an_array_is_not_guessed_to_be_a_rest_parameter` asserted

    assert!(cross(&string_array, ...).is_none());

Its name is about rest parameters. Its assertion is that `string[]` does not
cross the boundary **at all** — which was true only because `number[]` was the
only array that crossed, and which the rest question never needed. When arrays
were generalised, the test went red for the thing the change was *for*.

Nothing was wrong with the assertion when it was written; it was simply much
stronger than the property it was named after, so it held a second fact by
accident and nobody knew the second fact was load-bearing until it moved.

The repair is not a weaker test. It now asserts what the name claims *and*
carries a control — `Uint8Array[]` still refuses, because its element does —
so it says both that the element decides and which elements still cannot.

## A suite that skips without saying it skipped

`compiler/codegen/c/tests/execute.rs` builds and *runs* generated C. Without
`NTS_TSGO` it has no frontend, `run()` answers `None`, and every test returns
early — reporting **31 passed in 0.00s**.

The tuple representation change broke one of those tests. Run on its own it
said `ok`; run under the gate, which exports the variable, it failed on a
linker error. Two runs of one test, one green and one red, and the difference
was an environment variable — the green one having been "31 passed" is what
makes it dangerous, because a count that high reads as coverage.

`tsgo::locate`'s own doc says exactly this: a suite run with the variable unset
"is green whatever it would have found". Knowing that and still reading a local
`ok` as a pass is the same gap as the rest of this record.

## And one that fired on something nobody wrote

The reverse case, twice in one session. An indented block inside a `///`
comment is a **doctest**, so

    /// concrete emitted
    ///
    ///     v2 = v0->callback;

made `cargo test --doc` compile a line of C as Rust, and the gate failed at
`tests` on a change whose C was correct. The first time it cost a gate run; the
second time it cost another, because I had recorded the fix and not the rule.

It belongs here because it is the same family seen from the other side: a check
running on input its author did not know they had given it. The other four
answered a question nobody had asked; this one asked a question nobody had
written. Both come of not knowing what the instrument actually reads.

Use a `//` comment for a block of foreign syntax, or fence it. A `///` comment
containing an indented block is a test.

## What the four have in common, and what to do

Each check answered the question it was asked. None of them was asked whether it
*could* have answered differently.

- **For a fixture**, run it once against a tree where the defect is present. A
  fixture that has never been red is a fixture whose expectation has never been
  parsed. The two `class-name` ones were written before the fix for exactly this
  reason and both were still wrong first.
- **For a text assertion**, ask what else could make the text change. If the
  answer includes anything other than the fix, the assertion is about the text.
- **For a report**, ask what a reader will take it to mean and whether the check
  measures that. "Builds and loads" against "works" is a gap a second tool
  closes in one command.
- **For a stopping point**, notice that the answer becoming satisfying is not
  evidence. All four stopping points tonight were at the moment the output
  looked better.

The cheapest of these is the first, and it is the only one that is mechanical.
