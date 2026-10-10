// run: build
// A union arm can be tested without ever being allocated. The C field chain
// names Refused's descriptor even though only Accepted has a construction.
interface Accepted { accepted: true; status: number; detail: string }
interface Refused { accepted: false; reason: string; status: number }
type Outcome = Accepted | Refused;

function status(outcome: Outcome): number { return outcome.status; }
export function read(n: number): number {
  const value: Accepted = { accepted: true, status: n, detail: "accepted" };
  return status(value);
}
// The control's field occupies the same slot in every arm, so its read needs
// no descriptor test for the unallocated arm.
interface First { status: number; detail: string }
interface Second { status: number; reason: string; accepted: boolean }
function shared(value: First | Second): number { return value.status; }
export function control(n: number): number {
  const value: First = { status: n, detail: "shared" };
  return shared(value);
}

observe("read", String(read(7)));
observe("control", String(control(11)));
done();
