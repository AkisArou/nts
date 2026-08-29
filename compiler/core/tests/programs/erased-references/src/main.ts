// Erasing a reference, which is refused by name.
//
// A payload that is sometimes a pointer needs retain and release that switch
// on the tag, and reference counting that is subtly wrong does not announce
// itself — it frees something still in use, later, somewhere else. So the
// first representation carries scalars and says so, rather than storing a
// pointer in a union and hoping.
//
// Refused, which is why it is not an example: node answers and the compiled
// program does not exist.
function takes(value: unknown): number {
  return typeof value === "string" ? 1 : 0;
}

export function ofString(n: number): number {
  return takes("text") + n;
}
