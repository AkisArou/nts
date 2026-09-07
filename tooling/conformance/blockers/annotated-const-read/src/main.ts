// expect: NTS1001 `code`, which `Error` does not declare
//
// The half of the annotated-const blocker that is still open. `blockers/
// annotated-const-write` passes, because the repair widens at the *allocation*
// and its initializer is a `new`. Here the initializer is a **parameter**,
// there is no allocation to widen, and reading a member the declared type has
// and the value's type does not still refuses.
//
// Found by walking into it: extending the process-warning ABI to carry a
// warning's `code` meant reading it off an `Error`-typed parameter, which
// refused and cascaded to every `punycode` export. The ABI passes the code as a
// separate value instead, which is better anyway -- but the refusal is real and
// this is the shape of it.
interface Tagged extends Error {
  code?: string;
}

export function read(error: Error): string {
  const tagged: Tagged = error;
  return tagged.code ?? "";
}
