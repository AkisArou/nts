/** @ntsHeader <unistd.h> */
declare module 'c:publication' {
  import type {c_int} from '@nts/scalars';
  /** @ntsSymbol tcgetpgrp */
  export function native_group(fd:c_int):c_int;
}
