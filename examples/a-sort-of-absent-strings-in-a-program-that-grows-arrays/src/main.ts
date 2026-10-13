// The default `sort` of strings with an absent element, in a program that
// grows an array. Growing is decided for a whole program on the JVM, and a
// program that grows one sorts through another path (a growable array is a
// class with a backing store), which kept the old signature when the runtime
// learned which absence a null slot holds: it would not have verified. The
// fixed-length path is `outcomes/a-sort-over-an-absent-string-element`, which
// grows nothing -- one program could not hold both, so this is its twin.
export function sortWithUndefined(n: number): string {
  const xs: (string | undefined)[] = ["b", undefined];
  xs.push("a".repeat((n & 1) + 1));
  xs.sort();
  return xs.map((x) => x === undefined ? "U" : x).join(",");
}
export function sortWithNull(n: number): string {
  const xs: (string | null)[] = ["b", null];
  xs.push("a".repeat((n & 1) + 1));
  xs.sort();
  return xs.map((x) => x === null ? "N" : x).join(",");
}
// The control: every element present.
export function sortPresent(n: number): string {
  const xs: string[] = ["b", "c"];
  xs.push("a".repeat((n & 1) + 1));
  xs.sort();
  return xs.join(",");
}
