import { IcuTimeZone } from "../../../../../runtime/ecmascript/providers/icu/c/provider.ts";
import { IcuNumberFormatter } from "../../../../../runtime/ecmascript/providers/icu/c/number.ts";
import { digest, numberDigest, formatBenchmark } from "./common.ts";
export function main(): string {
  return (
    digest(new IcuTimeZone("America/New_York")) +
    "\n" +
    numberDigest(new IcuNumberFormatter("en-US", ".00##")) +
    "\n" +
    numberDigest(new IcuNumberFormatter("en-US-u-nu-mathbold", ".00##"))
  );
}
export function benchmark(iterations: number): number {
  return formatBenchmark(new IcuNumberFormatter("en-US", ".00##"), iterations);
}
