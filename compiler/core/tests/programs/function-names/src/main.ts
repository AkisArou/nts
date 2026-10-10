// One closure named by its binding, one by nothing, and two bound functions:
// of a local function and of a parameter.

function nameOf(f: (x: number) => number): string {
  return f.name;
}

function boundOf(f: (x: number) => number): (x: number) => number {
  return f.bind(null);
}

export function names(n: number): string {
  const add = (x: number): number => x + n;
  const known = add.bind(null);
  return (
    nameOf(add) +
    add.name +
    nameOf(known) +
    nameOf(boundOf(add)) +
    nameOf((x: number): number => x * 2)
  );
}
