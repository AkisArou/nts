# A second message contradicting the first

    http/src/server.ts:930:2  NTS1001 `createServer`, a declaration outside
                              every walk

The Node lane ranked that as **the single largest item on the compiled axis:
274 failing test files** resolve through `http.createServer`. Its body is one
line, `return new Server(options, listener)`, and the message says the function
vanished — that the lowering neither emitted it nor refused it, which is the
conservation law in `super::unaccounted` firing.

**It had been refused, with a cause, in the same output.**

    http/src/server.ts:154:17  NTS1001 a value of type
                               Managed(Set(Managed(Object(TypeId(11478)))))
                               where Float { bits: 64 } is wanted

`unaccounted` asks whether any diagnostic's span *covers* the declaration.
`createServer` is at 932 and its refusal is at 154 — seven hundred lines above,
inside the class it constructs — so no span covered it and the check concluded it
had disappeared. Two messages about one function, and the louder one was false.

## Found by instrumenting rather than by reading

Four hypotheses were wrong first, each plausible and each checked: a re-exported
function outside the walk, a name collision between `http`'s `createServer` and
`net`'s, an unrepresentable signature dropping it silently, and reachability
pruning it. Probes for the first three compiled cleanly, and the fourth was ruled
out by reading `root_names`.

What settled it was printing what the walk did:

    WALK createServer id=283677 copies=1 file=net/src/main.ts
    WALK ok  id=283677 name=createServer@main exported=true
    WALK createServer id=297260 copies=1 file=http/src/server.ts
    WALK err id=297260 a value of type Managed(Set(...)) where Float is wanted

Both walked. One lowered, one refused. Neither vanished.

## The fix is that only the walk knows

A refusal's *location* is the offending construct, and it routinely sits outside
the declaration being lowered. A span test cannot answer "was this declaration
refused"; the walk can, because it is holding the `Err`. It records the node, and
`unaccounted` skips it.

The conservation law is unchanged: every function is still lowered, refused, or
reported. What is removed is the third message for functions that already had the
second.

## Measured

31 sites across `runtime/node` and `runtime/web-platform` still report it,
against the 38 the Node lane counted before — different instruments, so the
comparison is indicative rather than exact, but `http.createServer` demonstrably
moved from the false message to its real one.

**The remaining 31 are not one thing**, which the Node lane established and is
the reason this record does not claim a cause: 38 sites carried the text over at
least three unlike shapes — object-literal method shorthand, an overload set, and
a plain exported function. The most numerous shape in the source cost almost
nothing on the axis, and 286 of the 297 files behind the message were the third.
Ranking by the message would have sent the reader at the wrong one.

That is the same failure as ranking causes by grepping their messages, arriving
from a new direction: here the message was not merely coarse, it was **wrong**,
and it was the top of a ranked list.
