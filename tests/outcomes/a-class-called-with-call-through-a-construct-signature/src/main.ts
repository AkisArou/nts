// A class held in an array of construct signatures and invoked with `.call`:
// JavaScript throws a TypeError before the constructor runs. C and LLVM treat
// the class value as a function value and exit abnormally; the JVM refuses
// the store of the class where a function type is declared. A `new` through
// the same variable is refused by design. Found by function-object-routes
// call-class-constructor-array.
interface Packet { value: number; }
class First { value: number; constructor(value: number) { this.value = value; } }
type Constructor = new (value: number) => Packet;
const choices: Constructor[] = [First];
function invoke(Ctor: Constructor, receiver: Packet, value: number): string {
  try { Ctor.call(receiver, value); return "returned"; } catch (error) { return error instanceof TypeError ? "TypeError" : "other"; }
}
for (const Ctor of choices) {
  const receiver: Packet = { value: 99 };
  observe("threw a TypeError", String(invoke(Ctor, receiver, 1) === "TypeError"));
  observe("receiver unchanged", String(receiver.value === 99));
}
done();
