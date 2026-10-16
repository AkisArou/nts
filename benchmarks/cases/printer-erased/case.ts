// Dynamic String(value) conversion, including the pending-raise poll after a
// printer callback. Two possible printers and two primitives keep the array's
// element erased; timing String(new Printer()) would allow a direct call.
// The timed input returns normally. Other positive inputs throw inside the
// loop, so even proving its trip count positive cannot remove the poll.
// expect-ir: all: count call.extern(nts_value_to_string) in work#whole == 1
// expect-ir: all: count call.extern(nts_raising) in work#whole == 1

class LeftPrinter {
  n: number;
  constructor(n: number) { this.n = n; }
  toString(): string {
    if (this.n === 13) throw 22;
    return "left";
  }
}

class RightPrinter {
  n: number;
  // Distinct layouts select distinct descriptor printers. Sharing LeftPrinter's
  // layout would exercise the existing named refusal instead of a callback.
  right: boolean;
  constructor(n: number) { this.n = n; this.right = true; }
  toString(): string {
    if (this.n === 17) throw 23;
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
