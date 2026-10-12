// run: check
//
// The default `sort` over a `(string | undefined)[]` holding an absent
// element is killed by SIGSEGV on C, LLVM and RC and throws a
// NullPointerException on the JVM, with nothing refused. node moves
// `undefined` to the end without comparing it, and would sort a `null` as the
// string "null" -- so unlike `join`, the answer depends on which absence the
// slot holds, and the slot (a null reference for both) does not say. The fix
// belongs with the element absence a `(T | null)[]` read loses
// (a-stored-null-read-through-an-unchecked-index).
//
// The control differs in one thing: the same sort with every element present.
export function sortWithUndefined(n: number): string {
  const xs: (string | undefined)[] = ["b", undefined, "a".repeat((n & 1) + 1)];
  xs.sort();
  return xs.map((x) => x === undefined ? "U" : x).join(",");
}
export function sortPresent(n: number): string {
  const xs: (string | undefined)[] = ["b", "c", "a".repeat((n & 1) + 1)];
  xs.sort();
  return xs.map((x) => x === undefined ? "U" : x).join(",");
}
