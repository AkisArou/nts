// The noop renderer does not support React Scopes: every operation throws.

function shim(..._args: unknown[]): never {
  throw new Error(
    "react-noop-renderer does not support React Scopes. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export const prepareScopeUpdate = shim;
export const getInstanceFromScope = shim;
