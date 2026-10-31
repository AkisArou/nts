// expect: emit-c -> foreign symbol `tcgetpgrp` collides with a runtime or compiled function
// The selected native C symbol is also declared by <unistd.h>. The control
// changes only the exported function name; the native call's result is unused.
import {native_group} from 'c:publication';
import type {c_int} from '@nts/scalars';
export function tcgetpgrp(n:number):number {
  native_group(0 as c_int);
  return n+1;
}
