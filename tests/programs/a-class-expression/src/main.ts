// A class expression is a class in every way a class declaration is, and
// differs in one: it binds no name of its own. Every walk over the program that
// read `CLASS_DECLARATION` and stopped there lowered a class expression's
// *fields* and none of its members, so the first two functions here compiled
// before this example existed and every one below them refused.

interface Shape {
  area(): number;
}

class Base {
  tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  name(): string {
    return "base:" + this.tag;
  }
}

const Plain = class {
  v = 7;
  w = 11;
};

// Two anonymous classes declaring the same member name. They are the case that
// a shared layout would answer alike -- `__object#twice` is the collision one
// construct over -- so they return different values rather than the same one.
const First = class {
  which(): number {
    return 1;
  }
};

const Second = class {
  which(): number {
    return 2;
  }
};

const WithState = class {
  v: number;
  constructor(x: number) {
    this.v = x * 3;
  }
  doubled(): number {
    return this.v * 2;
  }
  get tripled(): number {
    return this.v * 3;
  }
};

const Derived = class extends Base {
  constructor(n: number) {
    super("d" + n.toString());
  }
  name(): string {
    return super.name() + "+derived";
  }
};

const Squares = class implements Shape {
  side: number;
  constructor(side: number) {
    this.side = side;
  }
  area(): number {
    return this.side * this.side;
  }
};

// A named class expression. The name is in scope inside the body and nowhere
// else, so `Counted` is what the program says and `Tally` is what the class
// calls itself -- including for a `static`, which an anonymous class cannot
// have because a static is addressed by name from source.
const Counted = class Tally {
  static base = 100;
  n: number;
  constructor(n: number) {
    this.n = n;
  }
  total(): number {
    return Tally.base + this.n;
  }
};

const Outer = class {
  inner = 4;
};

const Nested = class extends Outer {
  outerPlus(): number {
    return this.inner + 1;
  }
};

export function fields(n: number): number {
  return new Plain().v + new Plain().w + n;
}

export function distinctLayouts(n: number): number {
  return new First().which() * 10 + new Second().which() + n;
}

export function constructed(n: number): number {
  return new WithState(n).doubled();
}

export function accessor(n: number): number {
  return new WithState(n).tripled;
}

export function derivedName(n: number): string {
  return new Derived(n).name();
}

export function throughTheBase(n: number): string {
  const b: Base = new Derived(n);
  return b.name();
}

export function throughAnInterface(n: number): number {
  const s: Shape = new Squares(n);
  return s.area();
}

export function namedExpression(n: number): number {
  return new Counted(n).total();
}

export function extendingAnExpression(n: number): number {
  return new Nested().outerPlus() + n;
}

// Declared inside the function, which is where a class expression is usually
// written. The binding holds nothing -- `new Local()` resolves through the
// checker's type -- and the members are lowered by the same walk that finds a
// class anywhere else.
export function local(n: number): number {
  const Local = class {
    v: number;
    constructor(x: number) {
      this.v = x + 5;
    }
    doubled(): number {
      return this.v * 2;
    }
  };
  return new Local(n).doubled();
}

export function twoLocals(n: number): number {
  const A = class {
    which(): number {
      return 3;
    }
  };
  const B = class {
    which(): number {
      return 4;
    }
  };
  return new A().which() * 10 + new B().which() + n;
}
