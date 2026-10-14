// A template literal type is a set of strings, and every value of one is a
// string: lib.dom's `crypto.randomUUID()` answers
// `${string}-${string}-${string}-${string}-${string}`. It had no
// representation, so a function returning one was refused, a call to a
// foreign one too, and a `typeof` of one did not fold. It is a string now
// (the Chromium lane's blocker a-foreign-function-returning-a-template-
// literal-type).
//
// Control, one difference: `plain` returns `string`.

type Id = `${string}-${string}`;
type Event = `on${string}`;

function makeId(n: number): Id {
  return `${n}-${n * 2}`;
}

function eventName(name: string): Event {
  return `on${name}`;
}

export function idLength(n: number): number {
  return makeId(n).length;
}

export function parts(n: number): number {
  const id: Id = makeId(n);
  return id.split("-").length * 100 + id.indexOf("-");
}

export function kind(n: number): number {
  const id = makeId(n);
  return typeof id === "string" ? 1 : 0;
}

export function compared(n: number): number {
  const a = eventName(n % 2 === 0 ? "click" : "load");
  const b: Event = "onclick";
  return (a === b ? 10 : 0) + a.length;
}

export function plain(n: number): number {
  const s: string = `${n}-${n}`;
  return s.length;
}
