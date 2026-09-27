// Replaces an error's stack with one captured elsewhere (a server's): a fork
// point, since a native program's errors have no stack to replace
// (replaceErrorStack.native.ts).

export function replaceErrorStack(error: Error, stack: string): void {
  error.stack = stack;
}
