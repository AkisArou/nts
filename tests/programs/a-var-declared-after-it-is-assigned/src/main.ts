// `var v;` is not a point at which anything happens.
//
// A `var` binding belongs to the function, not to the statement that spells
// it, so a declaration with no initializer evaluates nothing — the storage was
// already there and already holds whatever was written to it. This compiler
// treated the declaration as the moment the storage comes into existence and
// bound a placeholder zero over the earlier write:
//
//     function f() { v = 2; var v: number; return v; }
//     // node: 2.  this compiler, until 2026-09-18: 0
//
// Silently, with no diagnostic, on every backend.
//
// It is the same mistake as the module-scope redeclaration defect landed the
// same day, one scope in: a declaration read as *create the storage* where the
// language says *this name already has storage, and this line may or may not
// write it*.
//
// `let` and `const` are different and keep the placeholder. Their binding
// begins at the declaration, and a read before it is "used before being
// assigned" — the checker rejects the program, so there is no earlier value to
// preserve. `declaredLet` below is that control, and it passes on the compiler
// that got the `var` case wrong, which is what makes it a control rather than
// a second copy of the finding.
//
// # The arms
//
// Four of the five agree on the previous binary. Only `assignedFirst` moved,
// and a fixture whose every arm changes cannot show that a fix left the
// working paths alone.

/** The finding: assigned, then declared with no initializer. */
export function assignedFirst(n: number): number {
  v = n + 1;
  var v: number;
  return v;
}

/** Declared first, then assigned — the ordinary order, and already right. */
export function declaredFirst(n: number): number {
  var v: number;
  v = n + 1;
  return v;
}

/** `let`, which must keep the placeholder: its binding starts at the line. */
export function declaredLet(n: number): number {
  let v: number;
  v = n + 1;
  return v;
}

/** A declaration *with* an initializer still writes, wherever it sits. */
export function initializerWins(n: number): number {
  v = 99;
  var v = n + 1;
  return v;
}

/** Declared twice in one function, which is one binding and two writes. */
export function declaredTwice(n: number): number {
  var v = 1;
  v = 99;
  var v = n + 1;
  return v;
}
