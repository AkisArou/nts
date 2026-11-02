// run: check
// backend: jvm

// Control for a-class-called-with-call-through-a-construct-signature: the same `.call` route through an array of call signatures holding a function.
interface Packet { value: number; }
function first(this: Packet, value: number): void { this.value = value; }
type Callable = (this: Packet, value: number) => void;
export function probe(n: number): number {
  const choices: Callable[] = [first];
  const receiver: Packet = { value: n };
  choices[0].call(receiver, n + 1);
  return receiver.value === n + 1 ? 1 : 0;
}
