// An override declaring fewer parameters than the method it overrides: a
// call through the base passes them all, and JavaScript drops the ones the
// override does not name. Each case varies which class answers.

class Reader {
  read(size: number, scale: number): number {
    return size * scale;
  }
  twice(size: number): number {
    return this.read(size, 2) + this.read(size + 1, 3);
  }
}

class Constant extends Reader {
  override read(): number {
    return 100;
  }
}

class FirstOnly extends Reader {
  override read(size: number): number {
    return size + 7;
  }
}

function reader(which: number): Reader {
  if (which === 0) {
    return new Reader();
  }
  if (which === 1) {
    return new Constant();
  }
  return new FirstOnly();
}

/** Through the base: two parameters, one, and none. */
export function dropped(n: number): number {
  return reader((n | 0) & 3).twice(n & 15);
}

class Shape {
  scaled(_by: number): Shape {
    return new Shape();
  }
  label(): number {
    return 1;
  }
}

class Square extends Shape {
  override scaled(): Square {
    return new Square();
  }
  override label(): number {
    return 2;
  }
}

class Tile extends Square {
  override scaled(): Square {
    return new Tile();
  }
  override label(): number {
    return 3;
  }
}

function shape(which: number): Shape {
  if (which === 0) {
    return new Shape();
  }
  if (which === 1) {
    return new Square();
  }
  return new Tile();
}

/** A covariant result as well, down a chain of three. */
export function covariant(n: number): number {
  const which = (n | 0) & 3;
  return shape(which).scaled(n).label() * 10 + which;
}

// The base can throw too: an override's throw where the base cannot is a
// core defect (outcomes/a-throw-from-an-override-the-base-cannot-raise).
class Wide {
  raise(depth: number, by: number): number {
    if (depth > 6) {
      throw new RangeError("wide is too deep");
    }
    return depth * by;
  }
}

class Narrow extends Wide {
  limit = 0;
  override raise(): number {
    if (this.limit > 3) {
      throw new RangeError("too deep");
    }
    return this.limit + 50;
  }
}

/** A narrower override that can throw, caught at the call. */
export function raising(n: number): number {
  const narrow = new Narrow();
  narrow.limit = n & 7;
  const values: Wide[] = [new Wide(), narrow];
  try {
    return values[n & 1]!.raise(n & 7, 3);
  } catch {
    return -1;
  }
}
