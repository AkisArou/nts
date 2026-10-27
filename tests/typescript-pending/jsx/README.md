# JSX (`.tsx`)

**Why node cannot be the oracle:** node's type stripping does not accept
`.tsx` files, and the runner selects `.ts` only.

**The oracle these need:** TypeScript's emit of the case as `src/main.tsx` with
`jsx: "react"`, `jsxFactory: "h"` and `jsxFragmentFactory: "Fragment"`. Each
case declares its own `JSX` namespace and its own `h` (and `Fragment`), so
it needs no library: what is tested is the transform, the calls the factory
receives, in order.
