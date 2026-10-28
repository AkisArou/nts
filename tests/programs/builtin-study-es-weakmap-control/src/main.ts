// Source control for builtin-study-es-weakmap. The return observes its
// operation; it is not a claim that the ambient builtin is provided.


export function esWeakmapControl(): number {
  class K {} const w = new Map<K, number>(); const k = new K(); w.set(k, 1); return w.get(k) ?? -1;
}
