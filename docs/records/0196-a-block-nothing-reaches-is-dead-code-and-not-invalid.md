# 0196 — A block nothing reaches is dead code and not invalid

    for (const oldest of records.keys()) {
      records.delete(oldest);
      evicted = evicted + 1;
      break;
    }

    Error: invalid HIR: [Unreachable { func: "DnsCache#store", block: BlockId(27) }]

The shared web-platform tree could not be compiled at all. Not a refusal with a
count beside it — the whole run exited before any inventory, on a source
construct that is how an LRU eviction is written.

Every loop is built with a **latch**: the block that runs the update and jumps
back to the header. It exists before the body is lowered, because `continue`
needs its id. When the body leaves on every path, nothing ever jumps to it, and
it sits in the function with a `BlockId` the other terminators are numbered
around.

`while` was never affected — its latch *is* its header. `for` and `for...of`
have a separate one, which is the difference between the two shapes.

## The verifier was accurate and the conclusion was wrong

`Unreachable { block }` is a true statement about that function. Calling it
**invalid HIR** is not: the graph is well-formed, the program is correct, and
what is there is dead code.

The check still earns its place from the other side. A dead block reaches the C
backend as a label nothing jumps to, and the generated file is compiled with
`-Werror`, where `-Wunused-label` is fatal — the same argument `dce`'s module
comment makes about `-Wunused-but-set-variable`. So the block has to go, and the
check stays as the assertion that it went. What changed is which pass is
responsible: removal, rather than refusal.

## Renumbering, and the thing that is not a terminator

A `BlockId` is an index, so removing one shifts every later block and every
terminator naming one moves with it. That much is mechanical.

What is not mechanical is that **a terminator is not the only thing that names a
block**. `OpKind::Await` carries a `Rejection { handler, .. }` — the one edge
into a handler that no `throw` wrote, recorded at the lowering because that is
the only place that knows it exists. Its own doc says so, two hundred lines
away from the terminator definition.

Missing it took the tree from a verifier error to an out-of-bounds panic in
`suspend`, which reads that id as an index into its segment layout.

**The panic is the good outcome and that is the whole lesson.** A stale handler
id that happened to be *in range* would have resumed a rejected `await` into the
wrong handler and said nothing — no diagnostic, no crash, a program that runs
and settles the wrong thing. It was one arithmetic accident away, and nothing in
the design made the safe case likelier than the silent one.

## And the same blind spot was already in the verifier

`reachable_blocks` walked `Terminator::successors()` and nothing else, so a
handler reachable **only** by rejection was not reachable to it. That had never
been reported, because every handler it had seen was also reachable from a
`throw` — a latent false positive kept quiet by a coincidence of the corpus, and
found only by writing a second consumer of the same function and deleting what
it returned.

Two consumers of one answer is what exposed it. A single caller of
`reachable_blocks` had no way to be wrong about a block it never removed.

## What to take

When a data structure is indexed, every field of that index type is a
participant in every renumbering — and the ones inside *operations* are the ones
a reader of the terminator definition will not find. Record 0096's rule was
about shape failing to answer a nominal question; this is its dual: an **index**
answering a question about identity, correctly, everywhere it is written down
and nowhere it is not.

Grep for the type, not for the obvious holder. `BlockId` appears in four fields
of this IR and three of them are in `Terminator`.
