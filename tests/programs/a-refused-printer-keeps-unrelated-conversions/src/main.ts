// An unavailable printer must not remove conversions of unrelated values.
// The generic method and its printer are intentionally refused on both pins.
// Clean c8ee checks all 116 cases; 85ec drops primitive and quiet (58 remain).
// The controls change only the call through the erased conversion helper.
class Picker {
  pick<T>(value: T, fails: boolean): T {
    if (fails) throw 22;
    return value;
  }
}

class Unavailable {
  value = 1;
  toString(): string { return new Picker().pick("unavailable", false); }
}

class Quiet {
  label = "quiet";
  toString(): string { return this.label; }
}

function text(value: unknown): string { return String(value); }

export function primitive(n: number): string { return text(n); }
export function primitiveControl(n: number): string { return String(n); }
export function quiet(n: number): string { return text(new Quiet()) + n; }
export function quietControl(n: number): string { return "quiet" + n; }
