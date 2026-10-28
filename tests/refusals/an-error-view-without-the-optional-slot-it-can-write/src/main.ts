// expect: `dest` has no storage at any offset
//
// Reduced from runtime/node/internal/uv.ts: UVExceptionError has no dest slot,
// but a writable UVError view can store one. This is the storage mismatch
// behind the StandardStream#write refusal; R-2 does not widen data layouts.
// The one-difference control is programs/an-error-view-with-an-actual-optional-slot:
// it declares and initializes precisely that optional field.

interface UVError extends Error {
  code: string;
  dest?: string;
}

class UVExceptionError extends Error implements UVError {
  code: string;
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
