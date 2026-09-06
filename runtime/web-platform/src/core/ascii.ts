/** U+0009 TAB or U+0020 SPACE, the whitespace permitted in HTTP fields. */
export function isHTTPTabOrSpace(code: number): boolean {
  return code === 9 || code === 32;
}

/** Fetch's HTTP whitespace: TAB, LF, CR, or SPACE. It deliberately excludes FF. */
export function isHTTPWhitespace(code: number): boolean {
  return code === 9 || code === 10 || code === 13 || code === 32;
}

/** Infra's ASCII whitespace: TAB, LF, FF, CR, or SPACE. */
export function isASCIIWhitespace(code: number): boolean {
  return code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
}

export function trimHTTPTabOrSpace(value: string): string {
  let start = 0;
  let end = value.length;

  while (start < end && isHTTPTabOrSpace(value.charCodeAt(start))) start++;
  while (end > start && isHTTPTabOrSpace(value.charCodeAt(end - 1))) end--;

  return start === 0 && end === value.length ? value : value.slice(start, end);
}

export function trimHTTPWhitespace(value: string): string {
  let start = 0;
  let end = value.length;

  while (start < end && isHTTPWhitespace(value.charCodeAt(start))) start++;
  while (end > start && isHTTPWhitespace(value.charCodeAt(end - 1))) end--;

  return start === 0 && end === value.length ? value : value.slice(start, end);
}

export function trimASCIIWhitespace(value: string): string {
  let start = 0;
  let end = value.length;

  while (start < end && isASCIIWhitespace(value.charCodeAt(start))) start++;
  while (end > start && isASCIIWhitespace(value.charCodeAt(end - 1))) end--;

  return start === 0 && end === value.length ? value : value.slice(start, end);
}
