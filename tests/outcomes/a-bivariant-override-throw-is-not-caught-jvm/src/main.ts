// run: check
// backend: jvm
// A2 reduction: the method accepts unknown; only the receiver annotation
// distinguishes inherited dispatch from its direct throwing override.
class Handler {
  handle(input: any): any {
    return `base:${input}`;
  }
}
class TypedHandler extends Handler {
  override handle(input: unknown): string {
    if (typeof input !== "string") throw new TypeError("input.toUpperCase is not a function");
    return `typed:${input.toUpperCase()}`;
  }
}
function call(h: Handler, n: number): string {
  return String(h.handle(n === 1 ? 42 : "abc"));
}
export function work(n: number): string {
  try {
    return call(new TypedHandler(), n);
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "other error";
  }
}
