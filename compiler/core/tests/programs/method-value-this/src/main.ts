// The two receivers a method taken as a value can be called with
// (`FuncBuilder::method_receiver`), read by `tests/method_value_this.rs`.

class Plain {
  v = 1;
  get(): number {
    return this.v;
  }
}

class Base {
  v = 1;
  area(): number {
    return this.v;
  }
}

class Derived extends Base {
  area(): number {
    return this.v * 2;
  }
}

/** Nothing overrides `get`: any `Plain` will do, proven at entry. */
export function notOverridden(o: Plain, other: Plain): number {
  const m = o.get;
  return m.call(other);
}

/** `area` is overridden: only the object it was read from will do. */
export function overridden(o: Base, other: Base): number {
  const m = o.area;
  return m.call(other) + new Derived().area();
}
