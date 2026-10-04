import { PlainTime } from "../../../../../runtime/ecmascript/src/temporal/plain-time.ts";

// Public API representation witness. Test262 owns semantic test cases.
export function main(): string {
  const time = PlainTime.from("23:59:59.999999999");
  const midnight = time.round("microsecond");
  const changed = midnight.with({ minute: 30 });
  const added = changed.add({ seconds: 15 });
  const difference = changed.until(added);
  return (
    time.nanosecond + ":" + midnight.toString() + ":" + added.toString() + ":" + difference.seconds
  );
}
