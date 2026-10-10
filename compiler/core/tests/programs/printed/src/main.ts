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

/** Typed: the type settles each, so none goes through the runtime. */
export function typed(n: number): string {
  return [
    String(new Plain()),
    String(new Labelled()),
    String(new Failure("f")),
    String([n, 2]),
    String(["a", "b"]),
  ].join("|");
}
