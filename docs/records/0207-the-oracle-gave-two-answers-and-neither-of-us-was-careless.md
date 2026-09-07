# The oracle gave two answers, and neither of us was careless

A differential of this project's `TextDecoder` against node's found a divergence
within a minute of being written. The divergence is node's. This is the record of
how it was established, because the interesting part is not the bug — it is that
three separate oracles were wrong in one day and none of it was carelessness.

## The finding

    bytes: EA EF BB BF 41              node                    nts
    whole                              U+FFFD U+FEFF U+0041    same
    split 1 / 1 / 1 / 1 / 1            U+FFFD U+FEFF U+0041    same
    split 4 / 1                        U+FFFD U+FEFF U+0041    same
    split 2 / 3                        U+FFFD U+FEFF U+0041    same
    split 3 / 2                        U+FFFD U+FEFF U+0041    same
    split 1 / 2 / 2                    U+FFFD U+FEFF U+0041    same
    split 2 / 2 / 1                    U+FFFD U+FEFF U+0041    same
    split 1 / 3 / 1                    U+FFFD U+0041           differs
    split 1 / 4                        U+FFFD U+0041           differs

Nine splits. Node produces **two distinct answers for one byte sequence**
depending only on where the chunk boundaries fall. This project produces one.

The table was built in three passes by two lanes, each verifying the last rather
than accepting it. The first characterisation was whole-versus-streamed;
verification made it split-versus-split; verifying *that* added `1/4` and
`1/2/2`, which together pin the trigger; a third pass added `3/2` and `2/2/1`,
which hold it. Nobody was wrong at any stage.

A byte-order mark is removed only when a stream *starts* with one. Here the
stream starts with `EA`, a truncated three-byte lead, so the `EF BB BF` that
follows is U+FEFF and is data. Node's whole-buffer answer says exactly that. So
does its byte-at-a-time answer.

The trigger needs two things together: a **complete** `EF BB BF` at the head of a
`decode()` call, following a call that emitted nothing. `1/1/1/1/1` is correct
because every chunk is incomplete and held. `1/2/2` is correct because the
sequence straddles a boundary even though it begins at a head. Only when both
conditions hold does the code point disappear.

That combination is what closes off the charitable reading. If node had a rule
like "strip a byte-order mark at the start of any decode call", `1/1/1/1/1` would
lose it too. There is no rule under which `1/1/1/1/1` and `4/1` are right and
`1/3/1` is wrong.

`ignoreBOM: true` on the whole buffer gives the same answer as the default, which
confirms the whole-buffer path never classified those bytes as a byte-order mark
at all.

## Why the answer was not "change the decoder"

Because the pinned WPT fixtures were already passing. `textdecoder-streaming` and
`textdecoder-byte-order-marks` were pinned that morning, for unrelated reasons,
as part of taking the upstream corpus from 2,300 tests to 2,433. Without them the
evidence for this side would not have existed when it was needed, and the obvious
move — the implementation disagrees with node, so fix the implementation — would
have shipped node's bug into a second implementation.

That is the argument for growing a conformance corpus that no cost-benefit case
could have made in advance. It paid for itself in an unrelated afternoon.

## What happened to the test

The streaming comparison lost its oracle. Rather than delete the case or adopt
node's answer, the *property* changed: **a split must not be observable.**
Streamed output is now compared against this decoder's own whole-buffer output
for the same bytes.

That is a weaker oracle and a stronger statement. It catches every split-boundary
defect without borrowing anybody's opinion about the byte-order mark, and the
whole-buffer path still faces node across all twelve encoding and flag
combinations.

The disagreement itself became a test, asserting that node gives exactly **two**
distinct answers across the nine splits. If node ever becomes self-consistent,
that test fails, and the substitution above gets reconsidered rather than
outliving its reason. A workaround whose justification has quietly expired is
worse than the bug it was written for, and nothing else would ever say so.

## The part worth keeping

Three oracles were wrong in one day, in three different ways, across three lanes.

A hand-written oracle for a percent-decoding fuzz was wrong on its first run: its
lone-surrogate regular expression matched the trailing half of every valid pair,
so every astral character read as malformed and the function under test looked
broken. A reimplementation-as-oracle always has that failure mode, and it is
worse than no check because it points somewhere.

An unrouted-export gate searched one lane and reported, in the language of a
general fact, an answer that was only true of that subset — and a function was
deleted that thirteen modules in another lane depended on.

And here, a mature independent implementation, used as an oracle by two projects,
disagreeing with itself in a way visible only because somebody compared it
against something else.

The common thread is not carelessness. It is that **a check and the thing it
checks can both be reasonable and still not be about the same object.** A
differential locates a disagreement; it never says whose. What settles it is a
property neither implementation gets a vote on — self-consistency here, a
standard's text where one exists, a device measurement where the question is what
a platform actually does.

There is a fourth, and it belongs beside the three rather than under them.
**An oracle acquired after a disagreement is an oracle chosen while knowing what
it should say.** The fixtures that settled this one were pinned that morning for
unrelated reasons; had they been pinned in response to the divergence, the
selection would have been made by somebody who already had a preferred answer.
That is an argument for acquiring evidence before there is a question, which is
exactly the kind of work that cannot be justified by the case that eventually
needs it.

And the reports were incomplete at every stage, which is the same point in
miniature: the first draft of a characterisation is the only draft one person can
produce, and the second only exists because somebody else checked it.

## Still to do

The upstream issue is not filed. Reporting it to another project is an
outward-facing action and needs the repository owner's say-so; the table above is
the body it should lead with, because it is the form that removes the "streaming
is allowed to differ" answer.

Measured on Node.js v24.20.0.
