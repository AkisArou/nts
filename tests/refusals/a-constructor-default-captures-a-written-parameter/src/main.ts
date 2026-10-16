// expect: emit-c -> NTS2006 a field operation on something that is not an object
// The constant default is the one-change control; this callable has no parameter entry yet.
class Subject { value: number; constructor(x: number, read = () => x) { x = 2; this.value = read(); } }
class Control { value: number; constructor(x: number, read = () => 2) { x = 2; this.value = read(); } }
export function subject(n: number): number { return new Subject(n | 0).value; }
export function control(n: number): number { return new Control(n | 0).value; }
