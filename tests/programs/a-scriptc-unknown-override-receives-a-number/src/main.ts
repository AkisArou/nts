// Control: only the override parameter changes from string to unknown.
class Handler {
  handle(input: any): any {
    return `base:${input}`;
  }
}
class TypedHandler extends Handler {
  override handle(input: unknown): string {
    if (typeof input !== "string") return "TypeError";
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
