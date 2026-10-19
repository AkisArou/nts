// A CommonJS module whose export is one object, for export-equals-object.ts.
let count = 0;
const counter = {
  next(): number {
    count += 1;
    return count;
  },
  get current(): number {
    return count;
  },
};
export = counter;
