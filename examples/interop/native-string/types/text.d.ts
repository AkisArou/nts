// Hand-written. A TypeScript `string` parameter is `const char *`:
// NUL-terminated UTF-8, borrowed for the call and released after it.
/**
 * @ntsHeader "text.h"
 */
declare module "c:text" {
  import type { c_int, c_uint } from "c:types";

  export function text_length(s: string): c_int;
  export function text_byte(s: string, at: c_int): c_int;
  export function text_total(s: string): c_uint;
  /** `string | null`: a null string is a NULL `const char *`. */
  export function text_is_null(s: string | null): c_int;

  // Returned strings: C's `const char *`, copied into a string.
  export function text_greek(): string;
  /** A fresh copy the caller owns, released after it is read.
   * @ntsFree free */
  export function text_dup(s: string): string;
  /** The same function without the free, for the leak arm's control. */
  export function text_dup_unfreed(s: string): string;
  export function text_maybe(which: c_int): string | null;
  export function text_overlong(): string;
  /** Declared `string`, and returns NULL: the call must not complete. */
  export function text_broken_promise(): string;
}
