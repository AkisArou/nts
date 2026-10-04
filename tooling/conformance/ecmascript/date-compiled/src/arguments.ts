import { NtsDate } from "../../../../../runtime/ecmascript/src/date/builtins.ts";

// Original argument counts at the public typed API, independently of the
// scalar helper and the still-refused canonical Temporal input unions.
export function main(): string {
  const omitted = new NtsDate(0);
  const explicit = new NtsDate(0);
  const hours = new NtsDate(0);
  return (
    omitted.setUTCFullYear(2024) +
    ":" +
    explicit.setUTCFullYear(2024, undefined) +
    ":" +
    hours.setUTCHours(12, undefined) +
    ":" +
    NtsDate.UTC(2024) +
    ":" +
    NtsDate.UTC(2024, undefined)
  );
}
