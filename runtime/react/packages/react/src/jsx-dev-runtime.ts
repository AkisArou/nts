import { isDevelopment } from "shared/Build.ts";
import { jsxDEV as jsxDEVImpl } from "./jsx/ReactJSXElement.ts";

export { REACT_FRAGMENT_TYPE as Fragment } from "shared/ReactSymbols.ts";

// Only the development build has `jsxDEV`; production exports undefined, as
// upstream does.
export const jsxDEV: typeof jsxDEVImpl | undefined = isDevelopment ? jsxDEVImpl : undefined;
