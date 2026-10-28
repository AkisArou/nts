// Source control for builtin-study-web-headers. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourceHeaders { private values = new Map<string, string>(); set(key: string, value: string): void { this.values.set(key, value); } get(key: string): string | undefined { return this.values.get(key); } }

export function webHeadersControl(): string {
  const h = new SourceHeaders(); h.set("a", "b"); return h.get("a") ?? "missing";
}
