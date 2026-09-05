// A string enum member, chosen in a loop and compared.
//
// The point of the case is that choosing one costs nothing: the value is a
// constant in the binary, not something built.

enum Label {
  Short = "s",
  Long = "long",
}

export function work(n: number): number {
  let hits = 0;
  for (let i = 0; i < 16 + n; i++) {
    const chosen = i % 2 === 0 ? Label.Short : Label.Long;
    if (chosen === Label.Short) {
      hits = hits + 1;
    }
  }
  return hits;
}
