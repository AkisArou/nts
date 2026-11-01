// #113-A: the setter must write the same storage the reader captures.
function afterWrite(change: number): number {
  let value: number = 10;
  const read = (): number => value;
  class Gate {
    get amount(): number { return 10; }
    set amount(next: number) { value = next; }
  }
  const gate = new Gate();
  gate.amount = gate.amount + change;
  return read();
}
observe("ordinary", String(afterWrite(1)));
observe("fraction", String(afterWrite(0.5)));
done();
