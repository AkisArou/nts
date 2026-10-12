// An object whose class orders the interface's fields differently is viewed as
// `Face`, then passed on to a parameter typed by a structural alias. Every
// read through the alias must still find the object's own field, wherever its
// class put it. Main refuses the `S1` -> `Face` conversion by name and answers
// the rest; Part 2 stage B's first candidate (71bbfb181) licensed the view and
// then read `Plain.b` at `Face`'s position, a SIGSEGV on C.
interface Face { a: number; b: string }
class S1 { b = "x"; a = 1 }
class Q1 { a = 5; b = "q" }
function readA(f: Face): number { return f.a; }
type Plain = { a: number; b: string };
function g(p: Plain): string { return p.b; }
export function viaQ(n: number): number { return readA(new Q1()) + n; }
export function aliasRead(n: number): string {
  const f: Face = new S1();
  readA(f);
  return g(f) + n;
}
