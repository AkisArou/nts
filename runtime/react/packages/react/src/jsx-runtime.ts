import type { ReactElement } from "shared/ReactTypes.ts";

export { REACT_FRAGMENT_TYPE as Fragment } from "shared/ReactSymbols.ts";
export { jsx, jsxs } from "./jsx/ReactJSXElement.ts";

/**
 * What TypeScript types JSX as, under `"jsx": "react-jsx"`: it looks the
 * namespace up in this module. An element is a `ReactElement`, `children` is
 * the prop children are passed in, and a host's elements are whatever its
 * renderer accepts -- a host that types its elements narrows this.
 */
export declare namespace JSX {
  type Element = ReactElement;
  interface ElementChildrenAttribute {
    children: unknown;
  }
  interface IntrinsicElements {
    [element: string]: Record<string, unknown>;
  }
}
