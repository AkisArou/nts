// One face held two ways in one array: by a class whose fields begin with the
// face's, by one that keeps them in another order, and by a literal of the
// face. The reordered class moves the fields, so the face's reads dispatch:
// its row answers for it and the family's default for the other two.
//
// The JVM declined `run` ("storing a `Flat` where a `Point` is declared --
// `Point` carries state ...") while C agreed.

interface Point {
  x: number;
  y: number;
}

class Flat {
  x: number;
  y: number;
  z = 0;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

class Swapped {
  tag = "s";
  y: number;
  x: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

function shift(p: Point, by: number): number {
  p.x = p.x + by;
  return p.x * 10 + p.y;
}

export function run(n: number): number {
  const points: Point[] = [new Flat(1, 2), new Swapped(3, 4), { x: n & 3, y: 5 }];
  let total = 0;
  for (const p of points) {
    total += shift(p, n & 1);
  }
  return total;
}
