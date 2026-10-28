// Source control for builtin-study-web-url. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourceParams { get(key: string): string | null { return key === "c" ? "1" : null; } }
class SourceUrl { hostname: string; searchParams = new SourceParams(); constructor(value: string) { this.hostname = value.slice(8, 17); } }

export function webUrlControl(): string {
  const u = new SourceUrl("https://a.example/b?c=1"); return u.hostname + ":" + u.searchParams.get("c");
}
