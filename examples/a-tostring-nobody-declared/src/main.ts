// `${o}` where `o`'s class declares no `toString`: node prints
// `"[object Object]"`, and so does this, through the object's descriptor
// (`hir::Program::printed`).
//
// It was refused on purpose until 2026-10-10, on the argument that eight
// constant characters would make a missing method look like a working one.
// That is a judgement about the program's design, and a compiler that differs
// from node to deliver it is the wrong place for it; the text is what the
// language says.

class Plain {
  v: number;

  constructor(v: number) {
    this.v = v;
  }
}

export function describe(n: number): string {
  return `plain=${new Plain(n)}`;
}
