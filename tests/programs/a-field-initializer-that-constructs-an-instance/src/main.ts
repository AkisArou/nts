// Finite controls for the recursive field-initializer refusal. The private
// read changes only `new Recursive()` to `this`; siblings ensure the active
// initializer path is restored after each nested construction.
class Finite {
  #prop = 7;
  value: number = this.#prop;
}

export function control(n: number): number {
  return new Finite().value + n;
}

class Leaf {
  value = 11;
}

class Pair {
  first = new Leaf();
  second = new Leaf();
}

export function siblings(n: number): number {
  const pair = new Pair();
  return pair.first.value + pair.second.value + n;
}
