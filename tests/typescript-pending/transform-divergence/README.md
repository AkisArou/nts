# Where node's transform and TypeScript's emit disagree

**Why node cannot be the oracle:** for these programs node's
`--experimental-transform-types` and TypeScript's emit produce different
JavaScript, and node's throws `ReferenceError` where TypeScript's runs.
Node is right about JavaScript, but these are questions about TypeScript's
emit, which is what nts compiles to.

- **An unqualified reference to another block of a merged namespace**
  (`namespace-*-across-blocks.ts`). TypeScript resolves `base` in the
  second `namespace Units { }` block to the first block's export and emits
  `Units.base`; node's transform scopes each block alone and emits `base`.
  The suite's own `tests/typescript/namespaces/merging.ts` qualifies the
  name for this reason.
- **A `declare const enum`** (`declare-const-enum-is-inlined.ts`).
  TypeScript inlines each member's value (`3 /* Flags.Both */`) and needs
  no object; node's transform drops the declaration and leaves `Flags.Both`,
  which names nothing.

**The oracle these need:** TypeScript's emit with the suite's own options
(`target: "ESNext"`, `isolatedModules` off: inlining a `declare const enum`
needs the whole program).
