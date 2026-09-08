# Three readers each thought the value list was the program

A `ValueId` is an index into `Func::values`. So is a field index into a
layout, and so is a `BlockId` into `Func::blocks`. That makes renumbering
unavailable to a pass: taking an operation *out of the control flow* means
removing it from a block's `ops`, and it stays in the value list forever.

`excise_from_initializer` is the first pass that does this. Within an hour of
its existing, three separate readers had each misread the leftover:

    hir::drop_callers_of_refused   found the excised call again, re-excised
                                   nothing, and looped forever
    hir::verify::check_calls       refused to emit `os` over a call that was
                                   in no block
    codegen/c::drop_orphaned_bodies dropped `module#init` while `addon.c`
                                   still called it

The three are the same rule written three times — "a direct call naming a
function this program does not contain" — and all three scanned `func.values`.

## What each one cost

The first was a hang, and cheap: it never terminated, so it was found in one
run.

The second was a refusal to emit with a message naming a call the compiler had
removed. Its own doc comment already contained the correction: `MissingCallee`
says the call "reaches the linker as an undefined symbol", which is true only
of a call something *emits*, and every backend emits from the blocks.

The third is the expensive one, and it is the shape worth remembering. It
removed the body and left the addon's call to it. A shared object resolves
lazily, so the module **linked**:

    node: symbol lookup error: target/node/os.node: undefined symbol: module__init

    os.build/program.c   defines module__init:  0
    os.build/addon.c     references it:         2

Two `grep -c` counts are the whole diagnosis. The Node lane sent exactly those
two numbers with a guess attached, and said the guess was a guess — the guess
was that the excision had emptied the initializer, which was wrong and more
useful than being right, because the initializer was not empty and that ruled
out a whole class of cause in one line.

## The instrument that could not see it

The same lane had, twenty minutes earlier, converted its fixture into a guard
asserting that the export name appears in the addon's export table. It reported
`guard ok` on a module that dies at `dlopen`.

> **Publishing is not loading.**

That is the third variant of one sentence this week. A green gate step that
skipped its last step and exited 0. A node driver that truncated at the first
throw and reported a smaller denominator. And now an export-table assertion
that cannot tell a published name from a loadable one. Each time the check was
written by someone who had just been bitten by the previous variant.

The fourth arrived the same night, one level further in: a module-scope
statement whose refusal is *recovered from* leaves its global at the value it
already held, so the export reading it still compiles and answers a stale
constant. `NTS1005` says so in its own words — "every value this line would
have computed keeps whatever it held before it" — and describes it as the rest
of evaluation still running, which reads as the good outcome. **Initializing is
not computing.**

## What to do about it

Nothing general. The three readers now ask what a block holds, which is one
line each and is what all three meant.

What is worth keeping is the precondition: **a pass that removes an operation
from the control flow leaves a value nothing will emit, and every reader that
scans the value list is asking a question about a program that no longer
exists.** There are more such readers than three; these are the three that a
single new pass happened to reach in an hour.
