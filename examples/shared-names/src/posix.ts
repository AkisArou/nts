// One of two modules that declare `isSeparator`, and pass it as a value.
//
// Two functions cannot share a name in the emitted C, so `Naming` qualifies
// them apart by the file they came from. A *call* has known that since there
// were modules; the wrapper a function-used-as-a-value forwards through did
// not, and read the identifier as written instead.

function isSeparator(code: number): boolean {
  return code === 47;
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
  const path = n > 0 ? "a/b/c" : "a\\b\\c";
  return scan(path, isSeparator);
}

// Called directly as well, so the direct path and the wrapper both name it.
export function directly(n: number): number {
  return isSeparator(n | 0) ? 1 : 0;
}
