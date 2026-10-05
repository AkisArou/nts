import { icuStringCase } from "../../../../../runtime/ecmascript/providers/icu/c/string-case.ts";
import { stringCaseDigest } from "./string-case.ts";

export function main(): string {
  return stringCaseDigest(icuStringCase);
}
