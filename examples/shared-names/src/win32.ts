// The other one. The same name, a different body, and the same shape of use.

function isSeparator(code: number): boolean {
  return code === 92 || code === 47;
}

function scan(text: string, test: (code: number) => boolean): number {
  let found = 0;
  for (let i = 0; i < text.length; i++) {
    if (test(text.charCodeAt(i))) {
      found = found + 1;
    }
  }
  return found;
}

export function slashes(n: number): number {
  const path = n > 0 ? "a/b\\c" : "a\\b\\c";
  return scan(path, isSeparator);
}

export function directly(n: number): number {
  return isSeparator(n | 0) ? 1 : 0;
}
