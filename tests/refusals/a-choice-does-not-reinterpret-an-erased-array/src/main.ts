// expect: the two hold different widths
// A genuinely erased array arm must retain its width refusal. A destination
// can type a bare allocation, but cannot change the storage of an existing
// any[] variable. The control changes only the arm's declared element type.
class Holder {
  storage: number[];
  constructor(choose: boolean, erased: any[]) {
    this.storage = choose ? erased : new Array(2);
  }
}

class TypedHolder {
  storage: number[];
  constructor(choose: boolean, typed: number[]) {
    this.storage = choose ? typed : new Array(2);
  }
}

export function erased(n: number, values: any[]): number {
  const h = new Holder(n < 0, values);
  h.storage[0] = n;
  return h.storage[0];
}

export function typedControl(n: number): number {
  const h = new TypedHolder(n < 0, [0]);
  h.storage[0] = n;
  return h.storage[0];
}
