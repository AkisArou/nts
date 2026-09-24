// Renderers that don't support microtasks
// can re-export everything from this module.

function notSupported(): Error {
  return new Error(
    "The current renderer does not support microtasks. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export const supportsMicrotasks: boolean = false;
export function scheduleMicrotask(_callback: () => void): void {
  throw notSupported();
}
