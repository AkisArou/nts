// run: check
// A definite-assignment assertion does not initialize a field in JavaScript.
// The direct and shared-prefix reads currently answer false instead of true.
// The initialized control must continue to agree. Stage B must not turn its
// nonprefix interface field stop into the same wrong zero-valued read.
interface View { value: number; }

class Missing { padding = 17; value!: number; }
class Prefix implements View { value!: number; padding = 17; }
class Ready { value: number; constructor(n: number) { this.value = n; } }
class BeforeWrite {
  padding = 17;
  seen: boolean;
  value: number;
  constructor(n: number) {
    this.seen = readBeforeWrite(this);
    this.value = n;
  }
}

function readBeforeWrite(value: BeforeWrite): boolean {
  return value.value === undefined;
}

export function direct(_n: number): boolean {
  return new Missing().value === undefined;
}

export function throughPrefix(_n: number): boolean {
  const stored: unknown = new Prefix();
  const view = stored as View;
  return view.value === undefined;
}

export function initialized(n: number): number {
  return new Ready(n).value;
}

export function duringConstructor(n: number): boolean {
  return new BeforeWrite(n).seen;
}
