// Source control for builtin-study-web-urlsearchparams. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourceParams { constructor(private value: string) {} get(key: string): string | null { return this.value === "a=1&b=2" && key === "b" ? "2" : null; } }

export function webUrlsearchparamsControl(): string {
  return new SourceParams("a=1&b=2").get("b") ?? "missing";
}
