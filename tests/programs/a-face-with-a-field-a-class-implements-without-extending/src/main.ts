// A face with a field, which a class declares it implements without
// extending: stored at the face, called and written through it.
//
// The JVM declined `run` ("interface field accessor dispatch requires JVM
// stateful interfaces: `Tally` -> `Counter`") while C agreed. A face that
// carries state was a JVM class, which `Tally` does not extend; it is now
// referred to as an interface its holders implement, and `counter.seen` is
// the family accessor `Tally`'s row answers.

interface Counter {
  seen: number;
  bump(by: number): void;
}

class Tally implements Counter {
  label = "t";
  seen = 0;
  bump(by: number): void {
    this.seen += by;
  }
}

function drive(counter: Counter, n: number): number {
  counter.bump(n);
  counter.seen = counter.seen + 1;
  return counter.seen;
}

export function run(n: number): number {
  const kept: Counter = new Tally();
  return drive(kept, n & 7) + drive(new Tally(), 2);
}
