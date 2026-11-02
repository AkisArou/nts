// run: check
// backend: llvm

// A class held in an array of construct signatures and invoked with `.call`:
// JavaScript throws a TypeError before the constructor runs. C and LLVM treat
// the class value as a function value and exit abnormally; the JVM refuses
// the store of the class where a function type is declared. A `new` through
// the same variable is refused by design. Found by function-object-routes
// call-class-constructor-array.
interface Packet { value: number; }
class First { value: number; constructor(value: number) { this.value = value; } }
type Constructor = new (value: number) => Packet;
export function probe(n: number): number {
  const choices: Constructor[] = [First];
  const receiver: Packet = { value: n };
  const offset = (value: number): number => value + 1;
  choices[0].call(receiver, offset(n));
  return receiver.value === n ? 1 : 0;
}
