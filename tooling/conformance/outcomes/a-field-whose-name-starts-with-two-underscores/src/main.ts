// **A class field whose name starts with two underscores is refused as a member
// its class does not declare.** `class Instance { __snapshot = "" }` then
// `instance.__snapshot = "kept"` refuses: "`__snapshot`, which `Instance` does
// not declare". TypeScript interns an identifier beginning `__` with one more
// leading underscore (`escapeLeadingUnderscores`), so the symbol's escaped name
// is `___snapshot` while the source says `__snapshot`. The compiler has no
// handling of escaped names anywhere (checked by the compiler lane,
// 2026-09-27), so the write and the declared field do not meet.
//
// Found by the React lane: it is on React's render path
// (`__reactInternalSnapshotBeforeUpdate`), so it is expected to be fixed soon,
// and this is its day-one record. Reduction at
// `~/.cache/nts-react/probes/underscore-field`.
//
// Three arms, each in its own function so a refusal cuts only its own call:
//   `__snapshot`  the subject: refused today
//   `_snapshot`   one underscore, which TypeScript does not escape -- differs
//                 from the subject in one character, and must keep agreeing
//   `snapshot`    the plain control, which must keep agreeing
// When the fix lands this reads CHANGED, with the first arm's value in `ran`.

class Twice {
  state: string = "";
  __snapshot: string = "";
}

class Once {
  state: string = "";
  _snapshot: string = "";
}

class Plain {
  state: string = "";
  snapshot: string = "";
}

function twoUnderscores(): string {
  const instance = new Twice();
  instance.__snapshot = "kept";
  return instance.__snapshot;
}

function oneUnderscore(): string {
  const instance = new Once();
  instance._snapshot = "kept";
  return instance._snapshot;
}

function noUnderscore(): string {
  const instance = new Plain();
  instance.snapshot = "kept";
  return instance.snapshot;
}

observe("__snapshot written and read", twoUnderscores());
observe("_snapshot written and read", oneUnderscore());
observe("snapshot written and read", noUnderscore());
done();
