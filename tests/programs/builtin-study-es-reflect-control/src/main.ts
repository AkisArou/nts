// Source control for builtin-study-es-reflect. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
function sourceHas(value: { a: number }, key: string): boolean { return key === "a" && value.a === 1; }

export function esReflectControl(): boolean {
  return sourceHas({ a: 1 }, "a");
}
