// Source control for builtin-study-web-event. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourceTarget { name = "source target"; }
class SourceEvent { constructor(public type: string) {} }

export function webEventControl(): string {
  return typeof new SourceTarget() + ":" + new SourceEvent("x").type;
}
