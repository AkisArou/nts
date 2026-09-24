// Renderers that don't support React Scopes
// can re-export everything from this module.

function notSupported(): Error {
  return new Error(
    "The current renderer does not support React Scopes. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export function prepareScopeUpdate(_scopeInstance: unknown, _instance: unknown): void {
  throw notSupported();
}
export function getInstanceFromScope(_scopeInstance: unknown): unknown {
  throw notSupported();
}
