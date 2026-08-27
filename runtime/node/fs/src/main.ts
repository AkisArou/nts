// What a `node:fs` module looks like when we own it.
//
// Three layers, and only the middle one is ours to write:
//
//   TypeScript API   ← this file: typed, AOT-compiled, no `any`
//   native bindings  ← `declare function`, lowered to extern calls
//   Rust             ← deno_fs / std::fs, linked; see native/src/lib.rs
//
// The declarations below are the whole boundary. Everything above them is
// ordinary TypeScript that the compiler lowers like any other program.

declare function nts_fs_read_text(path: string): string;
declare function nts_fs_write_text(path: string, contents: string): void;
declare function nts_fs_exists(path: string): boolean;
declare function nts_fs_size(path: string): number;
declare function nts_fs_is_dir(path: string): boolean;
declare function nts_fs_mtime_ms(path: string): number;
declare function nts_fs_unlink(path: string): void;
declare function nts_errno(): number;

/** Node throws typed errors; so do we, and the code is part of the contract. */
export class FsError {
  // GAP: `readonly` fields are refused when the constructor assigns them, which
  // TypeScript explicitly permits. Dropped here; it is not a semantic change.
  code: string;
  path: string;
  syscall: string;
  constructor(code: string, path: string, syscall: string) {
    this.code = code;
    this.path = path;
    this.syscall = syscall;
  }
  // GAP: a getter is refused ("an object with an accessor"), so this is a
  // method. Node exposes `.message` as a property.
  message(): string {
    return this.code + ": " + this.syscall + " '" + this.path + "'";
  }
}

/** `errno` is the one place the native layer speaks in integers. */
function codeOf(errno: number): string {
  if (errno === 2) return "ENOENT";
  if (errno === 13) return "EACCES";
  if (errno === 21) return "EISDIR";
  if (errno === 17) return "EEXIST";
  if (errno === 20) return "ENOTDIR";
  return "UNKNOWN";
}

// `node:fs`'s Stats, with the fields that do not need a Date. Node returns a
// class instance here too, so `instanceof` keeps working.
export class Stats {
  size: number;
  mtimeMs: number;
  private directory: boolean;
  constructor(size: number, mtimeMs: number, directory: boolean) {
    this.size = size;
    this.mtimeMs = mtimeMs;
    this.directory = directory;
  }
  isDirectory(): boolean {
    return this.directory;
  }
  isFile(): boolean {
    return !this.directory;
  }
}

export function existsSync(path: string): boolean {
  return nts_fs_exists(path);
}

export function readFileSync(path: string): string {
  if (!nts_fs_exists(path)) {
    throw new FsError(codeOf(2), path, "open");
  }
  return nts_fs_read_text(path);
}

export function writeFileSync(path: string, contents: string): void {
  nts_fs_write_text(path, contents);
  const failed: number = nts_errno();
  if (failed !== 0) {
    throw new FsError(codeOf(failed), path, "open");
  }
}

export function statSync(path: string): Stats {
  if (!nts_fs_exists(path)) {
    throw new FsError(codeOf(2), path, "stat");
  }
  return new Stats(nts_fs_size(path), nts_fs_mtime_ms(path), nts_fs_is_dir(path));
}

export function unlinkSync(path: string): void {
  if (!nts_fs_exists(path)) {
    throw new FsError(codeOf(2), path, "unlink");
  }
  nts_fs_unlink(path);
}
