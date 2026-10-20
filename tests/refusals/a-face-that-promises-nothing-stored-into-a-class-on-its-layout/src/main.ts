// expect: emit-jvm -> where a `E` is declared -- a face that promises nothing is held as java/lang/Object here
//
// `Iterable<number>`, the empty class `E` and `Holder` share one empty
// layout. The JVM refers to the face as the root (`types::root_typed`), so
// a generator stored where it is declared is an upcast -- and storing that
// value onward where `E` is declared, which TypeScript allows since `E`
// promises nothing, is a downcast from Object to the layout's class. It was
// emitted as a free store: a `putfield` (and an `areturn`, and a captured
// variable's store) of an Object typed as `Holder`, and the verifier refused
// the whole program. A cast would not do: the value is a generator, so a
// program C and node agree on would throw ClassCastException. It declines.
//
// The control is `kept`: the same generator stored where the face itself is
// declared, the upcast the JVM emits.
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

class Holder {
  take(it: Iterable<number>, box: Box): number {
    box.e = it;
    return box.e === it ? 1 : 0;
  }

  kept(it: Iterable<number>, box: FaceBox): number {
    box.it = it;
    return box.it === it ? 1 : 0;
  }
}

export function answer(): number {
  return new Holder().take(numbers, new Box());
}

export function control(): number {
  return new Holder().kept(numbers, new FaceBox());
}
