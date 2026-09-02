// What case conversion costs, which is one string per conversion and no more.
//
// The result is stored into an object that outlives the iteration, so the
// allocation is not an artefact of the compiler failing to place it in a frame
// -- it genuinely has to be on the heap, and the floor below is not a record of
// today's behaviour.
//
// The store is the second half of the case. `box.text = ...` overwrites a slot
// holding the only reference to the previous conversion, and if that store does
// not give it back nothing will. That is the `nulled-field` bug class, and a
// method that allocates is exactly where it would reappear.

class Box {
  text: string;
  constructor() {
    this.text = "";
  }
}

export function work(n: number): number {
  const source = "Mixed Case Text Here";
  const box = new Box();
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    box.text = source.toLowerCase();
    total = total + box.text.length;
  }
  return total;
}
