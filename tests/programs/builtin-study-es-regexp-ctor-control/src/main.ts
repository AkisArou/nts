// Source control for builtin-study-es-regexp-ctor. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourcePattern { constructor(private pattern: string, private flags: string) {} test(value: string): boolean { return this.pattern === "a+" && this.flags === "g" && value.includes("a"); } }

export function esRegexpCtorControl(): boolean {
  return new SourcePattern("a+", "g").test("caaat");
}
