// run: check
// backend: llvm
// A2: ScriptC's any-base/string-override route, adapted to a scalar entry.
// Source: scriptc 8971d694b18a81a9a52b8f8208be22b182cb092b,
// tests/corpus/6401-override-param-variance.ts (Apache-2.0).
// The common return guard isolates the ABI from the separately recorded
// uncaught-override-throw defect; it preserves this entry's observed strings.
// Control changes only the override parameter from string to unknown.
class Handler {
  handle(input: any): any {
    return `base:${input}`;
  }
}
class TypedHandler extends Handler {
  override handle(input: string): string {
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
