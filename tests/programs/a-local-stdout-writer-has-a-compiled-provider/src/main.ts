// Control for a-process-stdout-write-has-no-compiled-provider.
// AWFY CD/Havlak companion. The writer is supplied by a local class instead of an ambient process declaration.
class Writer { write(value: string | number): unknown { return 0; } }
const process = { stdout: new Writer() };
export function work(n: number): number { process.stdout.write(""); return n; }
