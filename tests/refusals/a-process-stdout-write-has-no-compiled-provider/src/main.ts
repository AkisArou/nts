// expect: a method `write` with no declaration in the hierarchy
// AWFY CD/Havlak companion. The writer is supplied by a local class instead of an ambient process declaration.
class Writer { write(value: string | number): unknown { return 0; } }
declare const process: { stdout: { write(value: string | number): unknown } };
export function work(n: number): number { process.stdout.write(""); return n; }
