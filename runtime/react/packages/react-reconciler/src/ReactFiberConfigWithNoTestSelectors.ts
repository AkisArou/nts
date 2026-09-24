// Renderers that don't support test selectors
// can re-export everything from this module.

// Signatures over the renderer's own types: this module is re-exported by a
// renderer's config, which the build forks in for ReactFiberConfig.ts.
import type { Instance } from "react-reconciler/ReactFiberConfig.ts";

function shim(..._args: unknown[]): never {
  throw new Error(
    "The current renderer does not support test selectors. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export const supportsTestSelectors: boolean = false;
export const findFiberRoot: (node: Instance) => unknown = shim;
export const getBoundingRect: (node: Instance) => unknown = shim;
export const getTextContent: (fiber: unknown) => string | null = shim;
export const isHiddenSubtree: (fiber: unknown) => boolean = shim;
export const matchAccessibilityRole: (node: Instance, role: string) => boolean = shim;
export const setFocusIfFocusable: (node: Instance, focusOptions?: unknown) => boolean = shim;
export const setupIntersectionObserver: (targets: Instance[], callback: unknown, options?: unknown) => { disconnect: () => void; observe: (instance: Instance) => void; unobserve: (instance: Instance) => void } = shim;
