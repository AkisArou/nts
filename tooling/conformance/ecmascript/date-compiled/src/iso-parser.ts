import {
  parseInstant,
  formatInstant,
} from "../../../../../runtime/ecmascript/src/temporal/instant.ts";
import { ISOParser } from "../../../../../runtime/ecmascript/src/temporal/iso-parser.ts";

// Reuse the existing scalar Instant witness through the shared parser. The
// companion PlainTime fixture checks the actual public canonical signatures.
export function instantProbe(caseId: number): string {
  const text =
    caseId < 0
      ? "1969-12-31T23:59:59.999999999Z"
      : caseId < 3
        ? "2000-02-29T12:34:56.123456789+05:45"
        : "+275760-09-13T00:00:00Z";
  return formatInstant(parseInstant(text));
}
export function timeProbe(caseId: number): number {
  const text = caseId < 0 ? "T12-14[-14:00]" : caseId < 3 ? "202113[UTC]" : "23:59:59.999999999";
  return new ISOParser(text, true).timeNanoseconds();
}
