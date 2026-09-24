// Renderers that don't support test selectors
// can re-export everything from this module.

// Signatures over the renderer's own types: this module is re-exported by a
// renderer's config, which the build forks in for ReactFiberConfig.ts.
import type { Instance } from "react-reconciler/ReactFiberConfig.ts";

function notSupported(): Error {
  return new Error(
    "The current renderer does not support test selectors. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export const supportsTestSelectors: boolean = false;
export function findFiberRoot(_node: Instance): unknown {
  throw notSupported();
}
export function getBoundingRect(_node: Instance): unknown {
  throw notSupported();
}
export function getTextContent(_fiber: unknown): string | null {
  throw notSupported();
}
export function isHiddenSubtree(_fiber: unknown): boolean {
  throw notSupported();
}
export function matchAccessibilityRole(_node: Instance, _role: string): boolean {
  throw notSupported();
}
export function setFocusIfFocusable(_node: Instance, _focusOptions?: unknown): boolean {
  throw notSupported();
}
export function setupIntersectionObserver(_targets: Instance[], _callback: unknown, _options?: unknown): { disconnect: () => void; observe: (instance: Instance) => void; unobserve: (instance: Instance) => void } {
  throw notSupported();
}
