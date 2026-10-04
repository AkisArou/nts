import { NtsDate } from "../../../../../runtime/ecmascript/src/date/builtins.ts";
import { dateToInstant } from "../../../../../runtime/ecmascript/src/temporal/builtins.ts";

// Public typed inheritance and mutable-slot boundary witness. Semantic cases
// stay in original Test262; this checks actual compiled class/slot dispatch.
class OverriddenDate extends NtsDate {
  override getTime(): number {
    return 123;
  }
  override setTime(_milliseconds: number): number {
    return 123;
  }
  override setComponent(..._args: Parameters<NtsDate["setComponent"]>): number {
    return 123;
  }
}

class FormattedDate extends NtsDate {
  override toISOString(): string {
    return "custom";
  }
}

class NonFiniteDate extends NtsDate {
  override valueOf(): number {
    return Infinity;
  }
}

export function main(): string {
  const date = new OverriddenDate(0);
  const override = date.getTime();
  const utc = date.setUTCDate(2);
  const snapshot = NtsDate.milliseconds(date);
  const instant = dateToInstant(date).epochNanoseconds;
  const local = date.setDate(3);
  return [
    String(override),
    String(utc),
    String(snapshot),
    String(instant),
    String(local),
    String(NtsDate.from(date).getTime()),
    String(new NonFiniteDate(0).toJSON()),
    new FormattedDate(0).toJSON(),
  ].join("\n");
}

export function bridgeSnapshot(): bigint {
  return dateToInstant(new OverriddenDate(-1)).epochNanoseconds;
}
