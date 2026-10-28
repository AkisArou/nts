// Source control for builtin-study-web-domexception. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourceException { constructor(public message: string, public name: string) {} }

export function webDomexceptionControl(): string {
  const e = new SourceException("m", "AbortError"); return e.name + ":" + e.message;
}
