import { IcuLocaleData } from "../../../../../runtime/ecmascript/providers/icu/java/locale.ts";
import { listPublic } from "./list-public-common.ts";
export function main(): string {
  return listPublic(new IcuLocaleData());
}
