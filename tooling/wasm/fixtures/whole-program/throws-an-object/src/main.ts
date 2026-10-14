// test262's failure: an object of a class of its own, thrown and never
// caught, after a line the program had already written.
class Test262Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Test262Error";
  }
}
function assertSame(actual: number, expected: number): void {
  if (actual !== expected) throw new Test262Error(`Expected ${expected} but got ${actual}`);
}
console.log("before");
assertSame(1 + 1, 3);
console.log("after");
