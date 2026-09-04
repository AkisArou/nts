import {
  ERR_INVALID_ARG_TYPE,
  ERR_OUT_OF_RANGE,
} from "../../internal/errors.ts";
import { validateInteger } from "../../internal/validators.ts";

/** Normalize the public `fs.read*` position before any zero-length fast path. */
export function normalizeReadPosition(
  position: unknown,
  length: number,
): number | bigint {
  if (position === null || position === undefined) return -1;
  if (typeof position === "number") {
    validateInteger(position, "position", -1);
    return position;
  }
  if (typeof position === "bigint") {
    const maximum = 2n ** 63n - 1n - BigInt(length);
    if (position < -1n || position > maximum) {
      throw new ERR_OUT_OF_RANGE("position", `>= -1 && <= ${maximum}`, position);
    }
    return position;
  }
  throw new ERR_INVALID_ARG_TYPE("position", ["integer", "bigint"], position);
}
