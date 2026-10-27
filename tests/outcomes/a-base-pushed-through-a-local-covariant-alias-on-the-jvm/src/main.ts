// run: check
// backend: jvm
//
// The shape the JVM's container guard does decline by name (NTS4001): the
// alias and the store sit in one function, so the guard can see a `Base`
// being stored where a `Sub` is declared. This is the boundary of the
// guard: the same store across a function boundary compiles and aborts
// instead (a-base-pushed-through-a-covariant-array-dispatches-as-the-subclass-jvm).
// Probed at recording time, this local shape on the other backends: C and
// LLVM give the same wrong dispatch as the boundary shape, Wasm traps on
// the cast (`wasm trap: illegal cast`) rather than declining by name.

class Base {
  v(): number {
    return 1;
  }
}

class Sub extends Base {
  v(): number {
    return 2;
  }
}

export function through(seed: number): number {
  const subs: Sub[] = [new Sub()];
  const bases: Base[] = subs;
  bases.push(new Base());
  let t = 0;
  for (const s of subs) t = t * 10 + s.v();
  return t * 10 + ((seed | 0) & 1);
}
