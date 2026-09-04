// `fs.Stats`, node `lib/internal/fs/utils.js`.

import {
  S_IFBLK, S_IFCHR, S_IFDIR, S_IFIFO, S_IFLNK, S_IFMT, S_IFREG, S_IFSOCK,
} from "./constants.ts";

/**
 * What `statSync` returns.
 *
 * Node exposes each timestamp twice: `atimeMs` as a number of milliseconds and
 * `atime` as a `Date`. Both are here, and the `Date` pair is derived from the
 * number rather than stored, which is what node does too.
 */
export class Stats {
  dev: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  blksize: number;
  ino: number;
  size: number;
  blocks: number;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;

  constructor(columns: number[]) {
    this.dev = columns[0]!;
    this.mode = columns[1]!;
    this.nlink = columns[2]!;
    this.uid = columns[3]!;
    this.gid = columns[4]!;
    this.rdev = columns[5]!;
    this.blksize = columns[6]!;
    this.ino = columns[7]!;
    this.size = columns[8]!;
    this.blocks = columns[9]!;
    this.atimeMs = columns[10]!;
    this.mtimeMs = columns[11]!;
    this.ctimeMs = columns[12]!;
    this.birthtimeMs = columns[13]!;
    this.atime = new Date(this.atimeMs);
    this.mtime = new Date(this.mtimeMs);
    this.ctime = new Date(this.ctimeMs);
    this.birthtime = new Date(this.birthtimeMs);
  }

  private is(kind: number): boolean {
    return (this.mode & S_IFMT) === kind;
  }

  isFile(): boolean {
    return this.is(S_IFREG);
  }
  isDirectory(): boolean {
    return this.is(S_IFDIR);
  }
  isBlockDevice(): boolean {
    return this.is(S_IFBLK);
  }
  isCharacterDevice(): boolean {
    return this.is(S_IFCHR);
  }
  isSymbolicLink(): boolean {
    return this.is(S_IFLNK);
  }
  isFIFO(): boolean {
    return this.is(S_IFIFO);
  }
  isSocket(): boolean {
    return this.is(S_IFSOCK);
  }
}

/** `readdirSync(dir, { withFileTypes: true })`. */
export class Dirent {
  name: string;
  parentPath: string;
  private type: number;

  constructor(name: string, type: number, parentPath: string) {
    this.name = name;
    this.type = type;
    this.parentPath = parentPath;
  }

  // libuv's `uv_dirent_type_t`, which is what the scan reports.
  isFile(): boolean {
    return this.type === 1;
  }
  isDirectory(): boolean {
    return this.type === 2;
  }
  isSymbolicLink(): boolean {
    return this.type === 3;
  }
  isFIFO(): boolean {
    return this.type === 4;
  }
  isSocket(): boolean {
    return this.type === 5;
  }
  isCharacterDevice(): boolean {
    return this.type === 6;
  }
  isBlockDevice(): boolean {
    return this.type === 7;
  }
}
