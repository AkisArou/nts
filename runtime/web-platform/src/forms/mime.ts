import { isToken } from "../fetch/headers.ts";
import { isHTTPWhitespace, trimHTTPWhitespace } from "../core/ascii.ts";

export interface ParameterizedValue {
  value: string;
  parameters: ReadonlyMap<string, string>;
}
/** Strict parameter grammar for MIME and Content-Disposition; first duplicate wins. */
export function parseParameterized(input: string): ParameterizedValue {
  let at = input.indexOf(";");
  const value = trimHTTPWhitespace(at < 0 ? input : input.slice(0, at)).toLowerCase();
  const parameters = new Map<string, string>();

  if (at < 0) return { value, parameters };

  while (at < input.length) {
    at++;
    while (isHTTPWhitespace(input.charCodeAt(at))) at++;
    const start = at;
    while (at < input.length && input.charAt(at) !== "=" && input.charAt(at) !== ";") at++;
    const name = input.slice(start, at).toLowerCase();
    if (!isToken(name) || input.charAt(at) !== "=") throw new TypeError("Malformed MIME parameter");
    at++;
    while (isHTTPWhitespace(input.charCodeAt(at))) at++;
    let result = "";
    if (input.charAt(at) === '"') {
      at++;
      let closed = false;
      while (at < input.length) {
        let char = input.charAt(at++);
        if (char === '"') {
          closed = true;
          break;
        }
        if (char === "\\") {
          if (at >= input.length) throw new TypeError("Invalid quoted MIME parameter");
          char = input.charAt(at++);
        }
        if (char === "\r" || char === "\n" || char === "\0")
          throw new TypeError("Invalid MIME parameter byte");
        result += char;
      }
      if (!closed) throw new TypeError("Unclosed MIME parameter");
      while (isHTTPWhitespace(input.charCodeAt(at))) at++;
      if (at < input.length && input.charAt(at) !== ";")
        throw new TypeError("Trailing MIME parameter characters");
    } else {
      const startValue = at;
      while (at < input.length && input.charAt(at) !== ";") at++;
      result = trimHTTPWhitespace(input.slice(startValue, at));
      if (!isToken(result)) throw new TypeError("Invalid unquoted MIME parameter");
    }
    if (!parameters.has(name)) parameters.set(name, result);
  }
  return { value, parameters };
}
