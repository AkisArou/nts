// run: check
// backend: llvm
//
// The LLVM twin of a-base-pushed-through-a-covariant-array-dispatches-as-the-subclass
// (which records C): a `Base` pushed through a `Base[]` parameter into a
// `Sub[]` is dispatched as a `Sub`, so node answers 210/211 and LLVM 220/221.
// Nothing checks the static claim here either.

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

function addBase(xs: Base[]): void {
  xs.push(new Base());
}

export function through(seed: number): number {
  const subs: Sub[] = [new Sub()];
  addBase(subs);
  let t = 0;
  for (const s of subs) t = t * 10 + s.v();
  return t * 10 + ((seed | 0) & 1);
}
