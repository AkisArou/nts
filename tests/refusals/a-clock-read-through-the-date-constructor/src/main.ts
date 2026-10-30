// expect: NTS1001 a `new Date` with no argument, which reads a clock this compiler has no capability for and no differential could check is not supported by this lowering yet
//
// The one-difference control supplies a fixed instant to the constructor:
// tests/programs/a-fixed-instant-in-the-date-constructor.
export function theCurrentInstant(n: number): number {
  return new Date().getTime() + n;
}
