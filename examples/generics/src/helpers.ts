// A second module declaring `pick`, which `main.ts` also declares. Two
// TypeScript functions may share a name and two C functions may not, so each is
// qualified by the file it came from -- `pick@helpers` and `pick@main`. This is
// what `node:path` does with `posix.ts` and `win32.ts`, both declaring
// `basename`, and refusing it would refuse the module.
export function pick(a: number, b: number): number {
  return a > b ? a : b;
}
