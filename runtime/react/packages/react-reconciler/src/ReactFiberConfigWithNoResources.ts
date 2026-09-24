// Renderers that don't support resources
// can re-export everything from this module.

function shim(..._args: unknown[]): never {
  throw new Error(
    "The current renderer does not support Resources. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export type HoistableRoot = unknown;
export type Resource = unknown;
export const supportsResources: boolean = false;
export const isHostHoistableType = shim;
export const getHoistableRoot = shim;
export const getResource = shim;
export const acquireResource = shim;
export const releaseResource = shim;
export const hydrateHoistable = shim;
export const mountHoistable = shim;
export const unmountHoistable = shim;
export const createHoistableInstance = shim;
export const prepareToCommitHoistables = shim;
export const mayResourceSuspendCommit = shim;
export const preloadResource = shim;
export const suspendResource = shim;
