import { isHTTPWhitespace, trimHTTPWhitespace, trimTrailingHTTPWhitespace } from "../core/ascii.ts";
import { isToken } from "../fetch/headers.ts";

export interface MIMEType {
  readonly type: string;
  readonly subtype: string;
  readonly essence: string;
  readonly parameters: ReadonlyMap<string, string>;
}

export interface ParameterizedValue {
  value: string;
  parameters: ReadonlyMap<string, string>;
}

/** Serialize a parsed MIME type without inventing or reordering parameters. */
export function serializeMIMEType(mimeType: MIMEType): string {
  let output = mimeType.essence;
  for (const [name, value] of mimeType.parameters) {
    output += ";" + name + "=";
    if (isToken(value)) {
      output += value;
      continue;
    }
    output += '"';
    for (let index = 0; index < value.length; index++) {
      const character = value.charAt(index);
      if (character === '"' || character === "\\") output += "\\";
      output += character;
    }
    output += '"';
  }
  return output;
}

function isHTTPQuotedString(value: string): boolean {
  for (let i = 0; i < value.length; ++i) {
    const code = value.charCodeAt(i);

    if (code !== 9 && (code < 32 || code === 127 || code > 255)) {
      return false;
    }
  }
  return true;
}

/** WHATWG MIME parsing. Invalid parameters are ignored; an invalid essence fails. */
export function parseMIMEType(input: string): MIMEType | null {
  const source = trimHTTPWhitespace(input);
  const slash = source.indexOf("/");

  if (slash <= 0) {
    return null;
  }

  const type = source.slice(0, slash);
  let at = source.indexOf(";", slash + 1);
  const subtype = trimTrailingHTTPWhitespace(
    at < 0 ? source.slice(slash + 1) : source.slice(slash + 1, at),
  );

  if (!isToken(type) || !isToken(subtype)) {
    return null;
  }

  const parameters = new Map<string, string>();

  while (at >= 0 && at < source.length) {
    at++;
    while (isHTTPWhitespace(source.charCodeAt(at))) {
      at++;
    }

    const nameStart = at;

    while (at < source.length && source.charAt(at) !== ";" && source.charAt(at) !== "=") {
      at++;
    }

    const name = source.slice(nameStart, at).toLowerCase();

    if (at >= source.length) {
      break;
    }
    if (source.charAt(at) === ";") {
      continue;
    }

    at++;
    if (at >= source.length) {
      break;
    }

    let value = "";

    if (source.charAt(at) === '"') {
      at++;
      while (at < source.length) {
        const char = source.charAt(at++);

        if (char === '"') {
          break;
        }
        if (char === "\\") {
          if (at >= source.length) {
            value += "\\";
            break;
          }
          value += source.charAt(at++);
        } else {
          value += char;
        }
      }
      while (at < source.length && source.charAt(at) !== ";") {
        at++;
      }
    } else {
      const valueStart = at;

      while (at < source.length && source.charAt(at) !== ";") {
        at++;
      }
      value = trimTrailingHTTPWhitespace(source.slice(valueStart, at));
      if (value.length === 0) {
        continue;
      }
    }

    if (isToken(name) && isHTTPQuotedString(value) && !parameters.has(name)) {
      parameters.set(name, value);
    }
  }

  const lowerType = type.toLowerCase();
  const lowerSubtype = subtype.toLowerCase();

  return {
    type: lowerType,
    subtype: lowerSubtype,
    essence: lowerType + "/" + lowerSubtype,
    parameters,
  };
}

/** Strict Content-Disposition parameter grammar; first duplicate wins. */
export function parseContentDisposition(input: string): ParameterizedValue {
  let at = input.indexOf(";");
  const value = trimHTTPWhitespace(at < 0 ? input : input.slice(0, at)).toLowerCase();
  const parameters = new Map<string, string>();

  if (at < 0) {
    return { value, parameters };
  }

  while (at < input.length) {
    at++;
    while (isHTTPWhitespace(input.charCodeAt(at))) {
      at++;
    }
    const start = at;
    while (at < input.length && input.charAt(at) !== "=" && input.charAt(at) !== ";") {
      at++;
    }
    const name = input.slice(start, at).toLowerCase();
    if (!isToken(name) || input.charAt(at) !== "=") {
      throw new TypeError("Malformed Content-Disposition parameter");
    }
    at++;
    while (isHTTPWhitespace(input.charCodeAt(at))) {
      at++;
    }
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
          if (at >= input.length) {
            throw new TypeError("Invalid quoted Content-Disposition parameter");
          }
          char = input.charAt(at++);
        }
        if (char === "\r" || char === "\n" || char === "\0") {
          throw new TypeError("Invalid Content-Disposition parameter byte");
        }
        result += char;
      }
      if (!closed) {
        throw new TypeError("Unclosed Content-Disposition parameter");
      }
      while (isHTTPWhitespace(input.charCodeAt(at))) {
        at++;
      }
      if (at < input.length && input.charAt(at) !== ";") {
        throw new TypeError("Trailing Content-Disposition parameter characters");
      }
    } else {
      const startValue = at;
      while (at < input.length && input.charAt(at) !== ";") {
        at++;
      }
      result = trimHTTPWhitespace(input.slice(startValue, at));
      if (!isToken(result)) {
        throw new TypeError("Invalid unquoted Content-Disposition parameter");
      }
    }
    if (!parameters.has(name)) {
      parameters.set(name, result);
    }
  }
  return { value, parameters };
}
