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
}
