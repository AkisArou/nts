// The noop renderer does not support Singletons: every operation throws.

function shim(..._args: unknown[]): never {
  throw new Error(
    "react-noop-renderer does not support Singletons. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export const supportsSingletons: boolean = false;
export const resolveSingletonInstance = shim;
export const acquireSingletonInstance = shim;
export const releaseSingletonInstance = shim;
export const isHostSingletonType = shim;
export const isSingletonScope = shim;
