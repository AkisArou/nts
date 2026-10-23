// One name from each library a symbol can come from, beside one the program
// declares (`tests/libraries.rs`): lib.es's `JSON`, lib.dom's `document`,
// @types/node's `process`.
export function own(n: number): number {
  return n + 1;
}
export const text: string = JSON.stringify({ a: own(1) });
export const title: string = document.title;
export const platform: string = process.platform;
