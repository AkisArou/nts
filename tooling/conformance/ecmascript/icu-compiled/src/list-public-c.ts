import { IcuLocaleData } from "../../../../../runtime/ecmascript/providers/icu/c/locale.ts";
import { listPublic } from "./list-public-common.ts";
export function main(): string {
  return listPublic(new IcuLocaleData());
}
