# Component boundary: calling a component whose props type the reconciler cannot name

The reconciler holds elements of every component type in one tree, so it
cannot name `P`. The spike packs the existential in `createElement<P>`, which
NTS specialises for each `P`. That specialisation captures a typed adapter
`(erased: unknown) => type(erased as P)`, and the element stores it as one
uniform `(props: unknown) => Node`.

Results at nts `8e8ecc2e`, from a pinned worktree build:

- **0 refusals.** `nts check` agrees with node on 31 cases, both without a
  collector and with `--rc`.
- `createElement<obj15>` and `createElement<obj19>` each build their own
  adapter closure. The closure's `call` does `unerase` to that `P`'s layout
  and then `call.closure` on the captured component.
- Props are stored erased (16 bytes). The component receives its own fixed
  layout.

**Cost:** two indirect calls per render, the adapter and then the component
value. A JSX site names its component statically, so M4 can call it directly
once the reconciler's per-tag dispatch is specialised.

This is the pattern for every existential in the runtime: element type and
props, context values, and the payload of an update-queue action. A generic
constructor packs; a closure specialised for that generic unpacks.
