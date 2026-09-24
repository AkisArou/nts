// Renderers that don't support test selectors
// can re-export everything from this module.

function shim(..._args: unknown[]): never {
  throw new Error(
    "The current renderer does not support test selectors. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export const supportsTestSelectors: boolean = false;
export const findFiberRoot = shim;
export const getBoundingRect = shim;
export const getTextContent = shim;
export const isHiddenSubtree = shim;
export const matchAccessibilityRole = shim;
export const setFocusIfFocusable = shim;
export const setupIntersectionObserver = shim;
