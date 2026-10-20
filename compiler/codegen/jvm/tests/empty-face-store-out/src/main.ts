// Every way a value of a root-typed face reaches a place typed as a class
// on its layout: `Iterable<number>`, the empty class `E` and `H` are one
// layout. The four stores out of the face decline: a field, a return and a
// captured variable were each a free store of an Object typed as `H`, which
// the verifier refused, and an array element keeps `E[]`'s contract, so a
// typed read back would cast a generator to `H`. The argument is emitted
// (the core specializes `keep` to its caller's types), and so is the store
// into the face itself.
const numbers = (function* (): Generator<number> {
  yield 1;
})();

class E {}

class Box {
  e: E = new E();
}

class FaceBox {
  it: Iterable<number> = numbers;
}

function keep(e: E, other: E): number {
  return e === other ? 2 : 1;
}

class H {
  field(it: Iterable<number>, box: Box): number {
    box.e = it;
    return box.e === it ? 1 : 0;
  }

  returned(it: Iterable<number>): E {
    return it;
  }

  captured(it: Iterable<number>): number {
    let e: E = new E();
    const set = () => {
      e = it;
    };
    set();
    return e === it ? 1 : 0;
  }

  argument(it: Iterable<number>): number {
    return keep(it, new E());
  }

  element(it: Iterable<number>): number {
    const es: E[] = [new E()];
    es.push(it);
    return es.length;
  }

  kept(it: Iterable<number>, box: FaceBox): number {
    box.it = it;
    return box.it === it ? 4 : 0;
  }
}

export function stores(): number {
  const h = new H();
  return h.argument(numbers) * 100 + h.kept(numbers, new FaceBox());
}

export function element(): number {
  return new H().element(numbers);
}

export function field(): number {
  return new H().field(numbers, new Box());
}

export function returned(): number {
  const h = new H();
  return h.returned(numbers) === h.returned(numbers) ? 1 : 0;
}

export function captured(): number {
  return new H().captured(numbers);
}
