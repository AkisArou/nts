// Asking the operating system to change something about this process, from
// node v24.20.0 `lib/internal/process/per_thread.js` and `src/node_process_*`.
//
// The split in this file is between what talks to the kernel and what decides
// whether to. The deciding lives here; the parts that also have to read or
// emit on the process object itself -- `kill`, `exit` -- are in `main.ts`,
// because node makes both monkey-patchable through `process._kill` and
// `process.reallyExit` and its own tests rely on that.

import { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE, ERR_UNKNOWN_SIGNAL } from "../../internal/errors.ts";
import { parseFileMode, validateArray, validateString } from "../../internal/validators.ts";
import { constants } from "../../os/src/main.ts";
import { errnoException, uvException } from "../../internal/uv.ts";

declare function nts_process_cwd(): string;
declare function nts_process_chdir(directory: string): number;
/** The previous mask. Reading is `umask(new)` followed by `umask(previous)`. */
declare function nts_process_umask(mask: number): number;
declare function nts_process_umask_read(): number;
declare function nts_process_kill(pid: number, signal: number): number;
declare function nts_process_abort(): void;
declare function nts_process_really_exit(code: number): void;

declare function nts_process_getuid(): number;
declare function nts_process_getgid(): number;
declare function nts_process_geteuid(): number;
declare function nts_process_getegid(): number;
declare function nts_process_getgroups(): number[];
declare function nts_process_setuid(id: number, name: string): number;
declare function nts_process_setgid(id: number, name: string): number;
declare function nts_process_seteuid(id: number, name: string): number;
declare function nts_process_setegid(id: number, name: string): number;
/**
 * Two columns rather than one array of "number or string".
 *
 * A group can be named or numbered, and the two are different requests: a
 * system with a group literally called `0` has to be reachable by name. One
 * column would have to re-derive which was meant, and collapsing a name to a
 * placeholder id -- which this did at first -- turns "no such group" into "-1
 * is out of range".
 */
declare function nts_process_setgroups(ids: number[], names: string[]): number;
declare function nts_process_initgroups(user: string, group: number): number;

export function cwd(): string {
  return nts_process_cwd();
}

export function chdir(directory: string): void {
  validateString(directory, "directory");
  const err = nts_process_chdir(directory);
  // Both ends: node reports `chdir '/where/we/are' -> 'where-we-tried'`, and
  // the directory that failed is rarely enough on its own -- a relative path
  // that does not exist is only explicable against the one it was resolved
  // from.
  if (err !== 0) throw uvException(err, "chdir", nts_process_cwd(), directory);
}

/**
 * The file-mode creation mask.
 *
 * With no argument this reads; with one it sets and returns the previous
 * value. Reading is awkward at the system-call level -- `umask(2)` only ever
 * swaps -- so a host without a direct read has to set and set back, which is
 * a race if another thread creates a file in between. That is a property of
 * the system call rather than of this binding.
 */
export function umask(mask?: number | string): number {
  if (mask === undefined) return nts_process_umask_read();

  return nts_process_umask(parseFileMode(mask, "mask"));
}

/**
 * A signal name or number, as a number.
 *
 * The numbers are the host's own, read from `<signal.h>` at build time by
 * `node:os`. Hard-coding them would be wrong on the second platform: `SIGUSR1`
 * is 10 on Linux and 30 on macOS.
 */
export function signalNumber(signal: string | number): number {
  // The parentheses matter. `signal as number | 0` is a *type* -- the union of
  // `number` and the literal `0`, which is just `number` -- so the bitwise or
  // disappears and the comparison is `signal === signal`, true for everything.
  // Written that way it accepted `process.kill(0, "test")` and passed the
  // string to the system call.
  if (signal === ((signal as number) | 0)) return signal as number;
  const name = signal === undefined || signal === null || signal === 0 ? "SIGTERM" : signal;
  const number = constants.signals[name as string];
  if (number === undefined) throw new ERR_UNKNOWN_SIGNAL(String(name));
  return number;
}

/** The raw system call, which `process.kill` validates for. */
export function rawKill(pid: number, signal: number): number {
  return nts_process_kill(pid, signal);
}

/**
 * End the process immediately, without unwinding or running exit handlers.
 *
 * `abort` rather than `exit` because the point is the core dump: a program
 * that calls this has decided its state is not worth preserving and that
 * someone should look at why.
 */
export function abort(): never {
  nts_process_abort();
  // Unreachable, and the runtime knows: `nts_process_abort` does not return.
  throw new Error("process.abort did not abort");
}

export function reallyExit(code: number): void {
  nts_process_really_exit(code);
}

export function getuid(): number {
  return nts_process_getuid();
}
export function getgid(): number {
  return nts_process_getgid();
}
export function geteuid(): number {
  return nts_process_geteuid();
}
export function getegid(): number {
  return nts_process_getegid();
}
export function getgroups(): number[] {
  return nts_process_getgroups();
}

/**
 * A user or group, given either as a number or as a name to look up.
 *
 * A numeric *string* is a name, not a number: `setuid("0")` on a system with a
 * user literally called `0` has to mean that user. Node distinguishes them by
 * type and so does this.
 */
function identify(value: number | string, what: string): { id: number; name: string } {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
      throw new ERR_OUT_OF_RANGE(what, "an unsigned integer", value);
    }
    return { id: value, name: "" };
  }
  // Node names both types here rather than checking for a string, because
  // either is legitimate and an error saying only one is expected sends the
  // caller looking for the wrong mistake.
  if (typeof value !== "string") {
    throw new ERR_INVALID_ARG_TYPE(what, ["number", "string"], value);
  }
  return { id: -1, name: value };
}

function applyId(
  call: (id: number, name: string) => number,
  value: number | string,
  what: string,
  operation: string,
): void {
  const { id, name } = identify(value, what);
  const err = call(id, name);
  if (err !== 0) throw errnoException(err, operation);
}

export function setuid(value: number | string): void {
  applyId(nts_process_setuid, value, "id", "setuid");
}
export function setgid(value: number | string): void {
  applyId(nts_process_setgid, value, "id", "setgid");
}
export function seteuid(value: number | string): void {
  applyId(nts_process_seteuid, value, "id", "seteuid");
}
export function setegid(value: number | string): void {
  applyId(nts_process_setegid, value, "id", "setegid");
}

export function setgroups(groups: (number | string)[]): void {
  validateArray(groups, "groups");
  const ids: number[] = [];
  const names: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    const { id, name } = identify(groups[i] as number | string, `groups[${i}]`);
    ids.push(id);
    names.push(name);
  }
  const err = nts_process_setgroups(ids, names);
  if (err !== 0) throw errnoException(err, "setgroups");
}

export function initgroups(user: number | string, extraGroup: number | string): void {
  const { name } = identify(user, "user");
  const { id } = identify(extraGroup, "extraGroup");
  const err = nts_process_initgroups(name, id);
  if (err !== 0) throw errnoException(err, "initgroups");
}
