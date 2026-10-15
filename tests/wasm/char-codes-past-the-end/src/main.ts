// `charCodeAt` with an integer index: the code unit inside the string, and
// NaN before or past it, as node answers. A scan that runs off the end stops
// on that NaN, as JSON's number scanner does.

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

export function codeAt(at: number): number {
  const text = "héllo";
  const code = text.charCodeAt((at - 2) | 0);
  return code !== code ? -1 : code;
}

export function digitsFrom(at: number): number {
  const text = "1234567";
  let index = at | 0;
  let count = 0;
  while (isDigit(text.charCodeAt(index))) {
    index = (index + 1) | 0;
    count++;
  }
  return count;
}
