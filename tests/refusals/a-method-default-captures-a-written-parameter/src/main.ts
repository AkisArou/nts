// expect: NTS1001 a caller-filled default for `run` that captures a parameter binding, whose callable has no parameter entry
// The constant default is the one-change control; this callable has no parameter entry yet.
class Subject { run(x: number, read = () => x): number { x = 2; return read(); } }
class Control { run(x: number, read = () => 2): number { x = 2; return read(); } }
export function subject(n: number): number { return new Subject().run(n | 0); }
export function control(n: number): number { return new Control().run(n | 0); }
