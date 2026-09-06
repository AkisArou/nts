# Twenty-seven refusals said nothing, and two of them said the opposite

The goal asks for refusals grouped by underlying feature. Grouping 180 of them
against `runtime/web-platform` put **58 in a catch-all** — not because they were
miscellaneous but because they did not say enough to be anything else:

     9  a call returning an unrepresentable type
     9  an array literal of unrepresentable type (an array type)
     9  a method call of unexpected shape

A refusal that cannot be attributed is not a work item. Naming the types cost
almost nothing, because the helper already existed:

    /// Refuse, naming the type that could not be represented.
    fn unrepresentable(&self, id: NodeId, what: &str) -> Diagnostic

Seven sites called `unsupported` where `unrepresentable` was right there. What
they turned into is the whole point:

     9  a call result of unrepresentable type (`Generator`)

All nine were **iteration**, sitting in the catch-all because the message
omitted the one word that placed them.

## Two messages were not vague but wrong

`an array type` describes an array by the fact that it is an array, which the
reader knew. Naming the element — the same argument the `Structured` arm makes
two arms below, where naming the symbol turned 223 unreadable rows into two
features — produced:

     9  an array literal of unrepresentable type (an array of a representable type)

Which contradicts itself. That exact shape has been diagnosed here before, at
`lower_class`: *"38 sites in the node profile said 'a class of unrepresentable
type (a representable type)', which contradicts itself and points at the wrong
thing"*. Same cause: `unrepresentable` describes the *node's* type, and the node's
type is not what failed.

Here the failure is that `[]` is typed `never[]` — the checker saying the literal
decides nothing — and neither an expected type nor a contextual one supplied an
answer. Only the branch that discarded `never[]` knows that, so the message is
built there now: **an empty array literal in a position that does not say what
it holds**. Nine sites, one named feature.

`a method call of unexpected shape` was the other. "Unexpected" is a statement
about the reader. Printing the callee's kind and its children answered it in one
run:

    parts [Syntax(212), Syntax(28), Syntax(79)]     ×6
    parts [Syntax(214), Syntax(28), Syntax(79)]     ×3

`syntax::QUESTION_DOT_TOKEN` is 28. A member access carries a third child exactly
when it is optional-chained, and all nine were `record.timer?.cancel()`. They are
now **an optional-chained method call**, which is the optional family and not a
parser problem.

## What the grouping says now

    45  class and interface representability
    44  absence / optional family
    35  still unattributed          (was 58)
    22  iteration and generators    (was 13)
    14  typed arrays / ArrayBuffer
     9  promise executor closures
     7  regular expressions

Two features moved by more than half their size and neither moved because any
code changed. The absence family went from 26 to 44 and is now level with the
largest cluster in the source — nullable representation, optional chaining and
contextual typing for an empty literal are one area, and together with class
representability they are **half of everything refused**.

I had told the Node session that iteration was the largest cluster. It is 22.
The measurement I based that on was `runtime/node`, and the source that matters
now is a different program.

## The rule this is an instance of

Name the cause, never the remedy — and a message that names *no* cause is the
same failure with less to argue about. The 35 still in the catch-all are the
next pass; `a function declaration outside every walk` is nine of them and says
which walk it is not, rather than which one it should have been in.
