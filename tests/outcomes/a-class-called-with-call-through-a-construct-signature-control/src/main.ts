// Control for a-class-called-with-call-through-a-construct-signature: the same `.call` route through an array of call signatures holding a function.
interface Packet { value: number; }
function first(this: Packet, value: number): void { this.value = value; }
type Callable = (this: Packet, value: number) => void;
const choices: Callable[] = [first];
function invoke(fn: Callable, receiver: Packet, value: number): string {
  try { fn.call(receiver, value); return "returned"; } catch (error) { return error instanceof TypeError ? "TypeError" : "other"; }
}
for (const fn of choices) {
  const receiver: Packet = { value: 99 };
  observe("returned", String(invoke(fn, receiver, 1) === "returned"));
  observe("receiver written", String(receiver.value === 1));
}
done();
