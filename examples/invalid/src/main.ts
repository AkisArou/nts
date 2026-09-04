// This file does not typecheck ON PURPOSE.
//
// It is the fixture for the correctness gate: the frontend must refuse to hand a
// program with type errors to a backend. A C backend given `broken` would emit a
// function declared to return a string and returning a double, and nothing
// downstream could tell that the source was already wrong.
//
// Do not "fix" these errors.

export function broken(a: number): string {
  return a;
}

export const wrong: number = "not a number";
