import { uname, type UtsName } from "c:utsname";
import { local } from "c:memory";

// `uname` fills storage TypeScript owns. Each member is a fixed array stored
// inline, and reading one gives a pointer to its first element -- the decay C
// performs, so `buf.sysname[i]` is a byte of the string libc wrote.
export function sysnameLength(): number {
  const buf = local<UtsName>();
  if (uname(buf) !== 0) return -1;
  let n = 0;
  while (n < 65 && buf.sysname[n] !== 0) n++;
  return n;
}

// A later member, so an offset that is wrong by one field is visible: reading
// `machine` at the wrong offset lands inside `version` and gives its length.
export function machineFirstByte(): number {
  const buf = local<UtsName>();
  if (uname(buf) !== 0) return -1;
  return buf.machine[0];
}
