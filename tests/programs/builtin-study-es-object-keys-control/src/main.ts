// Source control for builtin-study-es-object-keys. The return observes its
// operation; it is not a claim that the ambient builtin is provided.


export function esObjectKeysControl(): number {
  const o = { a: 1, b: 2 }; return Object.keys(o).length * 10 + Object.entries(o).length;
}
