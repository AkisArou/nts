// A default export beside named ones, for default-and-named.ts.
export default class Widget {
  constructor(readonly size: number) {}
}
export const defaultSize = 4;
export function make(): Widget {
  return new Widget(defaultSize);
}
