# A member the type declares and a member it does not read the same

The Node session reported a compiler defect and was right:

    `subscribe`, which `EventListenerSignal` does not declare

`EventListenerSignal` declares `subscribe(callback: () => void): () => void` on
the line above. The refusal was a sentence about the source that was false, and
the reader it sends looking for a typo will not find one.

What is missing is not the member. It is a **representation for the member's
type** — a field whose type is a function has no layout here — so the property
was dropped from the layout and the lookup found nothing. Two different
failures, one sentence:

    `subscribe`, declared by `EventListenerSignal` with a type that has no
    representation (a function type)

`absent_member` now asks the type record whether it declares the name before
saying it does not. That is the same correction `lower_class` made when 38 sites
read *"a class of unrepresentable type (a representable type)"* — a message
built from the wrong type — and the same one that turned nine array literals
into `an empty array literal in a position that does not say what it holds`.
Three instances now, and the shape is always this: **the diagnostic describes
what it has in hand rather than what actually failed.**

## And a declaration that vanishes now says which one

`a function declaration outside every walk` is the conservation law's report:
every function the checker knows is either lowered or refused, never neither.
It named no function, which made it the one refusal that could not be acted on
at all — the reader is told something disappeared and not what.

    `cancel`, a declaration outside every walk
    `error`,  a declaration outside every walk
    `pull`,   a declaration outside every walk

The Node session's hypothesis was that these were swallowing a private method
whose cascade had no primary. **They were not** — all three are Streams
callbacks, and `EventTarget##dispatch` is not among them. So the report is now
useful in both directions: it named what it had, and by naming it, ruled out
what it did not have.

## Two lists that must agree with the header, and did not

The `ArrayBuffer` commit shipped with `nts_to_index` claiming `memory(none)`
where the header marks it `pure`, and with four `NTS_READS_ONLY` helpers absent
from `runtime::READS_ONLY`. Both are checked by tests, and both tests are in
the `tests` step — which I had been skipping, because another lane's jar was
mid-rebuild and failing it.

The commit message said the step was "run separately". What I actually ran was
my own crates, and neither of these lives in one. **A green step is a claim
about what it looked at**, and so is a sentence in a commit message: mine
described a check I had not performed on the code that needed it. The gate
caught both the moment the other lane settled, which is the system working —
but it worked in spite of the message rather than because of it.
