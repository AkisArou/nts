import { IcuTimeZone } from "../../../../../runtime/ecmascript/providers/icu/java/provider.ts";
import {
  IcuNumberData,
  IcuNumberFormatter,
} from "../../../../../runtime/ecmascript/providers/icu/java/number.ts";
import { digest, numberDigest, numberOptionsDigest, formatBenchmark } from "./common.ts";
export function main(): string {
  return (
    digest(new IcuTimeZone("America/New_York")) +
    "\n" +
    numberDigest(new IcuNumberFormatter("en-US", ".00##")) +
    "\n" +
    numberDigest(new IcuNumberFormatter("en-US-u-nu-mathbold", ".00##")) +
    "\n" +
    numberOptionsDigest(
      new IcuNumberData(),
      (skeleton) => new IcuNumberFormatter("en-US", skeleton),
    )
  );
}
export function benchmark(iterations: number): number {
  return formatBenchmark(new IcuNumberFormatter("en-US", ".00##"), iterations);
}
