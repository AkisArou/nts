// A date is one allocation and nothing else.
//
// No string, because the time value is a double and nothing formats it here;
// no table; no reference field, so the object is outside the cycle collector
// for the same reason a string is. That list is the claim, and an
// implementation that stored a formatted form beside the number — which is a
// plausible thing to do, since `toISOString` would then be a field read — would
// answer every program identically and show up here as thirty-four.
//
// Seventeen made and seventeen discarded, each read back before the next is
// made, so none escapes.

class Stat {
  atime: Date;
  constructor(ms: number) {
    this.atime = new Date(ms);
  }
  accessed(): number {
    return this.atime.getTime();
  }
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i++) {
    const s = new Stat(i * 1000);
    total = total + s.accessed();
  }
  return total;
}
