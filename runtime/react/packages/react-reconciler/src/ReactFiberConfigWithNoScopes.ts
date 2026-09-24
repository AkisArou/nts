// Renderers that don't support React Scopes
// can re-export everything from this module.



function shim(..._args: unknown[]): never {
  throw new Error(
    "The current renderer does not support React Scopes. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export const prepareScopeUpdate: (scopeInstance: unknown, instance: unknown) => void = shim;
export const getInstanceFromScope: (scopeInstance: unknown) => unknown = shim;
