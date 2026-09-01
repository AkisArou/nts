// A reference in an erased slot, where the tag decides whether there is one.
//
// `nts_value_retain` and `nts_value_release` inspect the tag, so a conditional
// obligation is still exactly one obligation -- which is the argument in
// record 0024 for erasure being a representation rather than a third ownership
// kind. This case is what would contradict it.

class Box {
  value: number;
  constructor(v: number) { this.value = v; }
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i++) {
    const box = new Box(i);
    const held: unknown = box;
    total = total + (held as Box).value;
  }
  return total;
}
