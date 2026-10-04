import { FixedTimeZone } from "../../../../../runtime/ecmascript/src/time/provider.ts";
import {
  formatInstant,
  parseInstant,
} from "../../../../../runtime/ecmascript/src/temporal/instant.ts";
import {
  addZonedDateTime,
  roundZonedDateTime,
} from "../../../../../runtime/ecmascript/src/temporal/zoned-arithmetic.ts";

// Reachability/compiled arithmetic witness. Its imports and native/JVM link
// requirements contain no ICU provider, locale context or host Date fallback.
export function main(): string {
  const zone = new FixedTimeZone("+05:30", 19800000);
  return (
    formatInstant(-1n, -1, zone) +
    "\n" +
    formatInstant(
      addZonedDateTime(parseInstant("2024-01-31T06:30Z"), zone, 0, 1, 0, 0, 1n, "constrain"),
      -1,
      zone,
    ) +
    "\n" +
    formatInstant(
      roundZonedDateTime(parseInstant("2024-01-31T07:01Z"), zone, 4, 1, "halfExpand"),
      -1,
      zone,
    ) +
    "\n" +
    formatInstant(roundZonedDateTime(1n, zone, 9, 1, "halfExpand"), -1, zone)
  );
}
