// Dynamic String(value) conversion, including the pending-raise poll after a
// printer callback. Two possible printers and two primitives keep the array's
// element erased; timing String(new Printer()) would allow a direct call.
// The positive timed input returns normally, but either printer can throw for
// another input, so removing the poll would lose a language exception.
// expect-ir: all: count call.extern(nts_value_to_string) in work == 1
// expect-ir: all: count call.extern(nts_raising) in work == 1

class LeftPrinter {
  n: number;
  constructor(n: number) { this.n = n; }
  toString(): string {
    if (this.n < 0) throw 22;
    return "left";
  }
}

class RightPrinter {
  n: number;
  constructor(n: number) { this.n = n; }
  toString(): string {
    if (this.n < 0) throw 23;
    return "right";
  }
}

export function work(iterations: number): number {
  const values: any[] = [
    new LeftPrinter(iterations),
    new RightPrinter(iterations),
    iterations + 17,
    "plain",
  ];
  let total = 0;
  for (let i = 0; i < 2048 * iterations; i++) {
    const text = String(values[i & 3]);
    // Consume the contents as well as the length: each conversion contributes
    // to the checksum, including the number supplied by the timed input.
    total += text.length + text.charCodeAt(0) + text.charCodeAt(text.length - 1);
  }
  return total;
}

// Every generated driver reads this through its volatile timed argument.
export const seed = 1;
