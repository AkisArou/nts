// Each control changes only a tagged constant argument to the same literal.
import {
  POSITIVE, NEGATIVE, SIGNED_MIN, SIGNED_MAX, UNSIGNED_MAX,
  accept_signed, accept_unsigned,
} from "c:bigint-constants";

export function positive(): boolean { return accept_signed(POSITIVE) === 9007199254740993n; }
export function positiveControl(): boolean { return accept_signed(9007199254740993n) === 9007199254740993n; }
export function negative(): boolean { return accept_signed(NEGATIVE) === -9007199254740993n; }
export function negativeControl(): boolean { return accept_signed(-9007199254740993n) === -9007199254740993n; }
export function signedMin(): boolean { return accept_signed(SIGNED_MIN) === -9223372036854775808n; }
export function signedMinControl(): boolean { return accept_signed(-9223372036854775808n) === -9223372036854775808n; }
export function signedMax(): boolean { return accept_signed(SIGNED_MAX) === 9223372036854775807n; }
export function signedMaxControl(): boolean { return accept_signed(9223372036854775807n) === 9223372036854775807n; }
export function unsignedMax(): boolean { return accept_unsigned(UNSIGNED_MAX) === 18446744073709551615n; }
export function unsignedMaxControl(): boolean { return accept_unsigned(18446744073709551615n) === 18446744073709551615n; }
