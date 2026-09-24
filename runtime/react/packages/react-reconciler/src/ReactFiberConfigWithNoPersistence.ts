// Renderers that don't support persistence
// can re-export everything from this module.

function shim(..._args: unknown[]): never {
  throw new Error(
    "The current renderer does not support persistence. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export const supportsPersistence: boolean = false;
export const cloneInstance = shim;
export const createContainerChildSet = shim;
export const appendChildToContainerChildSet = shim;
export const finalizeContainerChildren = shim;
export const replaceContainerChildren = shim;
export const cloneHiddenInstance = shim;
export const cloneHiddenTextInstance = shim;
