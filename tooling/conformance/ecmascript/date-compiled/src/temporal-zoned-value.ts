import { UTC } from "../../../../../runtime/ecmascript/src/time/provider.ts";
import { ZonedDateTime } from "../../../../../runtime/ecmascript/src/temporal/zoned-date-time.ts";
import { PlainDateTime } from "../../../../../runtime/ecmascript/src/temporal/plain-date-time.ts";

// Actual shared value-class/public-option witness, separate from the accepted
// scalar arithmetic fixture. Compiler refusals remain failures of this gate.
export function main(): string {
  const value = new ZonedDateTime(-1n, UTC);
  return value.toString() + "\n" + value.toInstant().toString();
}

export function fields(): string {
  return new ZonedDateTime(0n, UTC).with({ year: 2024, month: 2, day: 29 }).toString();
}

export function difference(): string {
  const start = new ZonedDateTime(0n, UTC);
  return start.until(start.add({ months: 1, nanoseconds: 1 }), { largestUnit: "month" }).toString();
}

export function conversion(): string {
  return new PlainDateTime(2024, 2, 29, 12).toZonedDateTime("UTC").toString();
}
