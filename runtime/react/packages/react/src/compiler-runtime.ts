// React Compiler's runtime: `c(size)` is the component's memo cache, an
// array of slots; `cacheOf(shape)` is the typed one nts-react writes, a
// record the component declares.
export { useMemoCache as c, useMemoCacheOf as cacheOf } from "react/ReactHooks.ts";
// The shape `cacheOf` takes, which nts-react annotates a hoisted shape with:
// an object literal has an interface's layout only where it is typed as one.
export type { MemoCacheShape } from "shared/ReactTypes.ts";
