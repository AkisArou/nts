// Asking the operating system to change something about this process, from
// node v24.20.0 `lib/internal/process/per_thread.js` and `src/node_process_*`.
//
// The split in this file is between what talks to the kernel and what decides
// whether to. The deciding lives here; the parts that also have to read or
// emit on the process object itself -- `kill`, `exit` -- are in `main.ts`,
// because node makes both monkey-patchable through `process._kill` and
// `process.reallyExit` and its own tests rely on that.

import {
  ERR_INVALID_ARG_TYPE,
  ERR_OUT_OF_RANGE,
  ERR_UNKNOWN_CREDENTIAL,
  ERR_UNKNOWN_SIGNAL,
} from "../../internal/errors.ts";
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
/**
 * Resolve the two credentials and call `initgroups(3)`.
 *
 * Empty names select the numeric column. The result is zero on success, one
 * for an unknown user, two for an unknown group, or a negative errno for a
 * failed system call. The two columns preserve the distinction between `0`
 * and `"0"`; they are different credential requests.
 */
declare function nts_process_initgroups(
  userId: number,
  userName: string,
  groupId: number,
  groupName: string,
): number;

export const cwd = nts_process_cwd;

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
export function signalNumber(signal: string | number | null | undefined): number {
  if (typeof signal === "number" && signal === (signal | 0)) return signal;
  const name = signal === undefined || signal === null ? "SIGTERM" : signal;
  if (typeof name !== "string") throw new ERR_UNKNOWN_SIGNAL(String(name));
  const number = constants.signals[name];
  if (number === undefined) throw new ERR_UNKNOWN_SIGNAL(String(name));
  return number;
}

/** The raw system call, which `process.kill` validates for. */
export const rawKill = nts_process_kill;

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

export const reallyExit = nts_process_really_exit;

export const getuid = nts_process_getuid;
export const getgid = nts_process_getgid;
export const geteuid = nts_process_geteuid;
export const getegid = nts_process_getegid;
export const getgroups = nts_process_getgroups;

/**
 * A user or group, given either as a number or as a name to look up.
 *
 * A numeric *string* is a name, not a number: `setuid("0")` on a system with a
 * user literally called `0` has to mean that user. Node distinguishes them by
 * type and so does this.
 */
function identify(value: unknown, what: string): { id: number; name: string } {
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
  credential: "User" | "Group",
): void {
  const { id, name } = identify(value, what);
  const result = call(id, name);
  // Node's native credential bindings reserve a positive result for a name
  // that could not be resolved. System failures use libuv's negative errno.
  // Keeping those two channels distinct matters for an unprivileged caller:
  // an unknown name is ERR_UNKNOWN_CREDENTIAL, while a known name usually
  // reaches the syscall and fails with EPERM.
  if (result === 1) throw new ERR_UNKNOWN_CREDENTIAL(credential, value);
  if (result !== 0) throw errnoException(result, operation);
}

export function setuid(value: number | string): void {
  applyId(nts_process_setuid, value, "id", "setuid", "User");
}
export function setgid(value: number | string): void {
  applyId(nts_process_setgid, value, "id", "setgid", "Group");
}
export function seteuid(value: number | string): void {
  applyId(nts_process_seteuid, value, "id", "seteuid", "User");
}
export function setegid(value: number | string): void {
  applyId(nts_process_setegid, value, "id", "setegid", "Group");
}

export function setgroups(groups: (number | string)[]): void {
  validateArray(groups, "groups");
  const ids = new Array<number>(groups.length);
  const names = new Array<string>(groups.length);
  for (let i = 0; i < groups.length; i++) {
    const { id, name } = identify(groups[i], `groups[${i}]`);
    ids[i] = id;
    names[i] = name;
  }
  const result = nts_process_setgroups(ids, names);
  if (result > 0) {
    const missing = groups[result - 1];
    if (missing === undefined) {
      throw new Error(`setgroups returned an invalid group index ${result - 1}`);
    }
    throw new ERR_UNKNOWN_CREDENTIAL(
      "Group",
      missing,
    );
  }
  if (result !== 0) throw errnoException(result, "setgroups");
}

export function initgroups(user: number | string, extraGroup: number | string): void {
  const identifiedUser = identify(user, "user");
  const identifiedGroup = identify(extraGroup, "extraGroup");
  const result = nts_process_initgroups(
    identifiedUser.id,
    identifiedUser.name,
    identifiedGroup.id,
    identifiedGroup.name,
  );
  if (result === 1) throw new ERR_UNKNOWN_CREDENTIAL("User", user);
  if (result === 2) throw new ERR_UNKNOWN_CREDENTIAL("Group", extraGroup);
  if (result !== 0) throw errnoException(result, "initgroups");
}
