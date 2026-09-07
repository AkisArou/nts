import { trimHTTPTabOrSpace } from "../core/ascii.ts";
import { ProtocolError } from "../core/errors.ts";
import type { Headers } from "../fetch/headers.ts";

/** Parse a normalized Content-Length field list under RFC 9110/9112 rules. */
export function contentLength(headers: Headers): number | null {
  const raw = headers.get("content-length");
  if (raw === null) return null;

  let result: number | null = null;
  let index = 0;
  while (true) {
    while (index < raw.length) {
      const code = raw.charCodeAt(index);
      if (code !== 9 && code !== 32) break;
      index++;
    }

    const digitsStart = index;
    let length = 0;
    while (index < raw.length) {
      const digit = raw.charCodeAt(index) - 48;
      if (digit < 0 || digit > 9) break;
      length = length * 10 + digit;
      index++;
    }
    if (index === digitsStart) throw new ProtocolError("Invalid Content-Length");
    if (!Number.isSafeInteger(length)) throw new ProtocolError("Content-Length is too large");

    while (index < raw.length) {
      const code = raw.charCodeAt(index);
      if (code !== 9 && code !== 32) break;
      index++;
    }
    if (result !== null && result !== length) {
      throw new ProtocolError("Conflicting Content-Length fields");
    }
    result = length;
    if (index === raw.length) return result;
    if (raw.charCodeAt(index) !== 44) throw new ProtocolError("Invalid Content-Length");
    index++;
  }
}

/** Test a comma-separated HTTP field for one case-insensitive token. */
export function hasToken(headers: Headers, name: string, token: string): boolean {
  const raw = headers.get(name);
  if (raw === null) return false;
  const expected = token.toLowerCase();
  let start = 0;
  while (start <= raw.length) {
    const comma = raw.indexOf(",", start);
    const end = comma < 0 ? raw.length : comma;
    if (trimHTTPTabOrSpace(raw.slice(start, end)).toLowerCase() === expected) return true;
    if (comma < 0) return false;
    start = comma + 1;
  }
  return false;
}
