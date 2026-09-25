// React Compiler's runtime: `c(size)` is the component's memo cache, an
// array of slots; `cacheOf(shape)` is the typed one nts-react writes, a
// record the component declares.
export { useMemoCache as c, useMemoCacheOf as cacheOf } from "react/ReactHooks.ts";
