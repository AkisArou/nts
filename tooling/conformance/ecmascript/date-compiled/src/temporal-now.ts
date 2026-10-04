import { NtsNow } from "../../../../../runtime/ecmascript/src/temporal/now.ts";

// The clock capability must carry nanosecond precision and preserve its read
// count through actual compiled closures and value construction. Original
// Test262 remains the builtin semantic corpus; it cannot inject a host clock.
class Clock {
  samples = 0;
  defaults = 0;
  sample(): bigint {
    this.samples++;
    return -1n;
  }
  defaultIdentifier(): string {
    this.defaults++;
    return "UTC";
  }
}

export function main(): string {
  const clock = new Clock();
  const now = new NtsNow(
    () => clock.sample(),
    () => clock.defaultIdentifier(),
  );
  const instant = now.instant();
  const date = now.plainDateISO();
  const time = now.plainTimeISO("UTC");
  const dateTime = now.plainDateTimeISO("+01:00");
  const zoned = now.zonedDateTimeISO();
  return (
    instant.epochNanoseconds +
    "\n" +
    date.toString() +
    "\n" +
    time.toString() +
    "\n" +
    dateTime.toString() +
    "\n" +
    zoned.toString() +
    "\n" +
    now.timeZoneId() +
    "\n" +
    clock.samples +
    "," +
    clock.defaults
  );
}

export function clamp(value: bigint): bigint {
  return new NtsNow(
    () => value,
    () => "UTC",
  ).instant().epochNanoseconds;
}

export function resolutionBeforeSample(): number {
  const clock = new Clock();
  const now = new NtsNow(
    () => clock.sample(),
    () => clock.defaultIdentifier(),
  );
  try {
    now.plainDateTimeISO("+");
  } catch {
    return clock.samples;
  }
  return -1;
}
