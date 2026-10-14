// An owned value released on one path and moved out on another.
//
// This is linearity where it is easiest to get wrong: `made` is consumed
// exactly once on both paths, by different operations. Release it on the
// return path as well and the answer stays right while the program frees a
// value it handed back.

class Box {
  value: number;
  constructor(v: number) { this.value = v; }
}

function maybe(v: number): Box | null {
  const made = new Box(v);
  if (v % 3 === 0) {
    return null;
  }
  return made;
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i++) {
    const got = maybe(i);
    total = total + (got === null ? 0 : got.value);
  }
  return total;
}
