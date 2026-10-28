// Source control for builtin-study-es-globalthis. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
const sourceGlobal = { value: 1 };

export function esGlobalthisControl(): string {
  return typeof sourceGlobal;
}
