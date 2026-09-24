// Renderers that don't support mutation
// can re-export everything from this module.

function shim(..._args: unknown[]): never {
  throw new Error(
    "The current renderer does not support mutation. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export type GestureTimeline = unknown;
export const supportsMutation: boolean = false;
export const cloneMutableInstance = shim;
export const cloneMutableTextInstance = shim;
export const appendChild = shim;
export const appendChildToContainer = shim;
export const commitTextUpdate = shim;
export const commitMount = shim;
export const commitUpdate = shim;
export const insertBefore = shim;
export const insertInContainerBefore = shim;
export const removeChild = shim;
export const removeChildFromContainer = shim;
export const resetTextContent = shim;
export const hideInstance = shim;
export const hideTextInstance = shim;
export const unhideInstance = shim;
export const unhideTextInstance = shim;
export const clearContainer = shim;
export const getCurrentGestureOffset = shim;
