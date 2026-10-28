// Source control for builtin-study-es-regexp-test. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourcePattern { constructor(private text: string) {} test(value: string): boolean { return value.includes(this.text); } }

export function esRegexpTestControl(): boolean {
  return new SourcePattern("a").test("caaat");
}
