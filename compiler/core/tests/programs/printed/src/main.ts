// What each kind of object prints as (`hir::Program::printed`), read by
// `tests/printed.rs`. Every value is converted through `unknown`, so each
// layout is one the program prints.

class Plain {
  v = 1;
}

class Labelled {
  toString(): string {
    return "labelled";
  }
}

class Failure extends Error {
  code = 3;
}

function show(value: unknown): string {
  return String(value);
}

export function all(n: number): string {
  const add = (x: number): number => x + n;
  const pair: [number, string] = [n, "s"];
  const literal = { toString: (): string => "own" };
  return [
    show(new Plain()),
    show(new Labelled()),
    show(new Failure("f")),
    show(add),
    show(pair),
    show(literal),
  ].join("|");
}
