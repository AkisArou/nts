# A local in a function the list forgot

    fn is_within_a_function(&self, id: NodeId) -> bool {
        ...
            Some(FUNCTION_DECLARATION | METHOD_DECLARATION | CONSTRUCTOR)

Four kinds missing: `ARROW_FUNCTION`, `FUNCTION_EXPRESSION`, `GET_ACCESSOR`,
`SET_ACCESSOR`. `collect_module_scope` walks every `VARIABLE_DECLARATION` in the
program and skips the ones inside a function, so a `const` declared in any of
those four became a **module-scope global** and its initializer was deferred to
`module#init` — where the enclosing function's parameters and receiver do not
exist.

    const f = (k: number) => { const c = k + 1; return c; };
    NTS1001 `k`, a name from an enclosing scope

`k` is the arrow's own parameter. The diagnostic describes `module#init`
faithfully and describes the source falsely.

## Two entries in the ranking, one function

The same fault also produced ``NTS1001 `this` outside a method``, from the same
mechanism for the same reason. So it appeared in every census as two unrelated
items, in two different parts of the ranking, and **neither entry named this
function**:

    a name from an enclosing scope   192 across eleven modules
    `this` outside a method          ~170 across the same

`docs/records/0264` already recorded that grouping by message text ranks texts
rather than causes. This is the same lesson from the other end: one cause wearing
two texts, where the previous case was one text worn by three causes.

## What actually pointed here

The `this` half was found first and fixed somewhere else entirely — record 0266,
a field initializer lowered at the allocation site. That fix cleared some of the
`this` refusals and left the rest saying exactly the same words.

**A fix that clears part of a message's count is evidence that the message has
more than one cause.** That is the whole of how this was found, and it is worth
more than the fix: a census cannot see it, because a census reports the count
before and the count after and both are just numbers.

The remainder was `console`:

    count = (label = "default") => {
      const c = (this.#counts.get(label) ?? 0) + 1;

still refusing — at the `this` **inside the `const`**, not at the first one in
the body. The column said so. I read the line instead, twice, and built a
hypothesis about the capture collector missing a traversal; the capture was
recorded correctly and the body failed anyway. `read-the-failing-line-first` is
a rule I have written down and did not follow.

## The message is trustworthy now, which is the point

"a name from an enclosing scope" is a real refusal for a real construct — a
nested `function` declaration closing over an enclosing local, which this
compiler does not lower. `runtime/node/path/src/glob-matcher.ts:596` is one, and
`blockers/enclosing-scope-name-in-a-nested-function` is exactly it.

Those stayed. What went is the ones that were never about scope, and a reader
following the message now finds a capture that is there.

## Measured

Per module, before and after, in the six where both ends were taken with the
same instrument:

    module    enclosing      this        total
    stream      22 -> 20   23 -> 5   1641 -> 1617
    net         23 -> 20   29 -> 7   1492 -> 1463
    process     37 -> 29   38 -> 14  1932 -> 1896
    fs          30 -> 24   32 -> 12  2059 -> 2029
    util          7 -> 5   10 -> 0   1190 -> 1174
    events        6 -> 4   10 -> 0   1127 -> 1111

`util`, `events` and `console` reach **zero** `this` refusals. 151 diagnostics
across those six, and no module's total moved for any other reason.

The `enclosing` column falls less than the `this` column because the honest
cases are most of what is left, which is what a trustworthy message looks like.

`examples/a-local-const-in-every-kind-of-function` covers all four kinds with
two controls: the one function kind that was already listed, and a genuine
module-scope `const` that must still be folded as one — the half that must not
move when a check is widened.
