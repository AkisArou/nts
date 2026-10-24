// An erased structural cast reads the concrete owner's field, not the
// asserted layout's slot. Front and Back differ only in field order; Missing
// and Present differ only by the added stack field. direct is the control
// for later: it reads the same Back object without erasing and asserting it.
class Missing {
  first = 11;
  second = 22;
  constructor(public label: string) {}
}
class Present extends Missing {
  stack = "present";
}
class Front {
  stack: string;
  padding = 7;
  constructor(value: string) { this.stack = value; }
}
class Back {
  padding = 7;
  stack: string;
  constructor(value: string) { this.stack = value; }
}
class Wrong {
  padding = 7;
  stack: number;
  constructor(value: number) { this.stack = value; }
}
function stackOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null) {
    const held = caught as { stack?: string };
    return typeof held.stack === "string" ? held.stack : "no stack";
  }
  return "not an object";
}
export function absent(n: number): string {
  return stackOf(new Missing("x" + n));
}
export function present(n: number): string {
  return stackOf(new Present("x" + n));
}
export function first(n: number): string {
  return stackOf(new Front("x" + n));
}
export function later(n: number): string {
  return stackOf(new Back("x" + n));
}
export function direct(n: number): string {
  return new Back("x" + n).stack;
}
export function wrongKind(n: number): string {
  return stackOf(new Wrong(n));
}
export function literal(n: number): string {
  return stackOf({ padding: n, stack: "literal" });
}
export function missingLiteral(n: number): string {
  return stackOf({ padding: n });
}
export function scalar(n: number): string {
  return stackOf(n);
}
export function alias(n: number): string {
  const source: unknown = n > 0 ? new Back("alias") : new Missing("missing");
  const held = source as { stack?: string };
  const same = held;
  return typeof same.stack === "string" ? same.stack : "no stack";
}
export function bracket(n: number): string {
  const source: unknown = n > 0 ? new Back("bracket") : new Missing("missing");
  const held = source as { stack?: string };
  return typeof held["stack"] === "string" ? held["stack"] : "no stack";
}
// The literal is contextually built at the very same anonymous face as the
// cast. The slot receives both its own storage and another owner's storage.
export function ownShape(n: number): string {
  const source: unknown = n > 1 ? new Back("cast") : new Missing("missing");
  const cast = source as { stack?: string };
  let held: typeof cast = { stack: "literal" };
  if (n > 0) held = cast;
  return typeof held.stack === "string" ? held.stack : "no stack";
}
