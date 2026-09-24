// The noop renderer does not support test selectors: every operation throws.

function shim(..._args: unknown[]): never {
  throw new Error(
    "react-noop-renderer does not support test selectors. " +
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
