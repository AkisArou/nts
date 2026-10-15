// `at` on a `(T | null)[]`: a stored `null` is node's `null`, an index past
// either end its `undefined`, and a present element itself -- two answers one
// null pointer cannot be, told apart by `nts_array_at_element`.

class Point {
  constructor(public x: number) {}
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `string:${value}`;
  return value instanceof Point ? `point:${value.x}` : "other";
}

export function strings(at: number): string {
  const xs: (string | null)[] = ["a", null, "c"];
  return describe(xs.at(at));
}

export function points(at: number): string {
  const xs: (Point | null)[] = [new Point(1), null, new Point(3)];
  return describe(xs.at(at));
}

export function grown(at: number): string {
  const xs: (string | null)[] = [];
  for (let i = 0; i < 4; i++) xs.push(i % 2 === 0 ? `s${i}` : null);
  return describe(xs.at(at));
}
