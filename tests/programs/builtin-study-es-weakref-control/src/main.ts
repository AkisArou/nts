// Source control for builtin-study-es-weakref. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourceRef<T> { constructor(private value: T) {} deref(): T { return this.value; } }

export function esWeakrefControl(): boolean {
  class K {} const k = new K(); return new SourceRef(k).deref() === k;
}
