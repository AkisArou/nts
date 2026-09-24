// The noop renderer does not support mutation (the persistent entry): every operation throws.

function shim(..._args: unknown[]): never {
  throw new Error(
    "This entrypoint of react-noop-renderer does not support mutation. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

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
export const applyViewTransitionName = shim;
export const restoreViewTransitionName = shim;
export const cancelViewTransitionName = shim;
export const cancelRootViewTransitionName = shim;
export const restoreRootViewTransitionName = shim;
export const cloneRootViewTransitionContainer = shim;
export const removeRootViewTransitionClone = shim;
export const measureInstance = shim;
export const measureClonedInstance = shim;
export const wasInstanceInViewport = shim;
export const hasInstanceChanged = shim;
export const hasInstanceAffectedParent = shim;
export const startViewTransition = shim;
export const startGestureTransition = shim;
export const stopViewTransition = shim;
export const addViewTransitionFinishedListener = shim;
export const createViewTransitionInstance = shim;
export const getCurrentGestureOffset = shim;
