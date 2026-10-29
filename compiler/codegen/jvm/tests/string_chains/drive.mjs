import * as program from "./main.ts";
for (const n of [0, 1, 3, 17]) {
  for (const name of ["linear", "measured", "oldAlias", "duplicate", "published", "caughtOld", "fieldAlias", "indirect", "optional", "discarded"]) {
    console.log(`${name}/${n}=${program[name](n)}`);
  }
}
