// Source control for builtin-study-es-array-from. The return observes its
// operation; it is not a claim that the ambient builtin is provided.


export function esArrayFromControl(): string {
  return Array.from([0, 0, 0], (_, i) => i).join(",");
}
