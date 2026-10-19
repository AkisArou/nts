// A CommonJS module whose export is a function, for export-equals-function.ts.
function greet(who: string): string {
  return `hello ${who}`;
}
export = greet;
