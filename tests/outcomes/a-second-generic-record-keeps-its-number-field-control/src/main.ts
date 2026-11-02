// Control for a-second-generic-record-keeps-its-number-field: the same two
// calls, with the type parameter replaced by its argument's interface.
interface Owner { base: number; }
function compute(input: Owner, r: number): { owner: Owner; result: number } {
  return { owner: input, result: r };
}
const first = compute({ base: 1 }, 7);
const second = compute({ base: 2 }, 7);
observe("first call", String(first.result));
observe("second call", String(second.result));
done();
