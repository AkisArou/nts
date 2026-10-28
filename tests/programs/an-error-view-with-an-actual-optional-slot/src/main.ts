// The control for refusals/an-error-view-without-the-optional-slot-it-can-write.
// Only the dest field differs: it is an actual optional slot initialized to
// undefined. Both forms have the same observed values under node; the subject
// refuses on both compiler pins, and this control agrees on C, LLVM and JVM.
// Adding a class field changes own-property shape, so this is a boundary
// control, not a proposed change to runtime/node/internal/uv.ts.

interface UVError extends Error {
  code: string;
  dest?: string;
}

class UVExceptionError extends Error implements UVError {
  code: string;
  dest?: string = undefined;
  constructor(n: number) {
    super("uv");
    this.code = "error:" + String(n);
  }
}

export function result(n: number): string {
  const error: UVError = new UVExceptionError(n);
  if (n >= 0) error.dest = "target:" + String(n);
  return error.code + ":" + String(error.dest);
}
