// `fs.Stats`, node `lib/internal/fs/utils.js`.

import {
  S_IFBLK, S_IFCHR, S_IFDIR, S_IFIFO, S_IFLNK, S_IFMT, S_IFREG, S_IFSOCK,
} from "./constants.ts";
import { Buffer } from "../../buffer/src/main.ts";

function statColumn(columns: number[], index: number): number {
  const value = columns[index];
  if (value === undefined) {
    throw new Error(`fs stat result is missing column ${index}`);
  }
  return value;
}

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
    this.dev = statColumn(columns, 0);
    this.mode = statColumn(columns, 1);
    this.nlink = statColumn(columns, 2);
    this.uid = statColumn(columns, 3);
    this.gid = statColumn(columns, 4);
    this.rdev = statColumn(columns, 5);
    this.blksize = statColumn(columns, 6);
    this.ino = statColumn(columns, 7);
    this.size = statColumn(columns, 8);
    this.blocks = statColumn(columns, 9);
    this.atimeMs = statColumn(columns, 10);
    this.mtimeMs = statColumn(columns, 11);
    this.ctimeMs = statColumn(columns, 12);
    this.birthtimeMs = statColumn(columns, 13);
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

export interface StatOptions {
  bigint?: boolean;
}

export interface StatSyncOptions extends StatOptions {
  throwIfNoEntry?: boolean;
}

/** The exact-integer form selected by `{ bigint: true }`. */
export class BigIntStats {
  dev: bigint;
  mode: bigint;
  nlink: bigint;
  uid: bigint;
  gid: bigint;
  rdev: bigint;
  blksize: bigint;
  ino: bigint;
  size: bigint;
  blocks: bigint;
  atimeMs: bigint;
  mtimeMs: bigint;
  ctimeMs: bigint;
  birthtimeMs: bigint;
  atimeNs: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  birthtimeNs: bigint;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;

  constructor(columns: string[]) {
    this.dev = bigintColumn(columns, 0);
    this.mode = bigintColumn(columns, 1);
    this.nlink = bigintColumn(columns, 2);
    this.uid = bigintColumn(columns, 3);
    this.gid = bigintColumn(columns, 4);
    this.rdev = bigintColumn(columns, 5);
    this.blksize = bigintColumn(columns, 6);
    this.ino = bigintColumn(columns, 7);
    this.size = bigintColumn(columns, 8);
    this.blocks = bigintColumn(columns, 9);
    this.atimeNs = bigintColumn(columns, 10);
    this.mtimeNs = bigintColumn(columns, 11);
    this.ctimeNs = bigintColumn(columns, 12);
    this.birthtimeNs = bigintColumn(columns, 13);
    this.atimeMs = this.atimeNs / 1_000_000n;
    this.mtimeMs = this.mtimeNs / 1_000_000n;
    this.ctimeMs = this.ctimeNs / 1_000_000n;
    this.birthtimeMs = this.birthtimeNs / 1_000_000n;
    this.atime = new Date(Number(this.atimeMs));
    this.mtime = new Date(Number(this.mtimeMs));
    this.ctime = new Date(Number(this.ctimeMs));
    this.birthtime = new Date(Number(this.birthtimeMs));
  }

  private is(kind: number): boolean {
    return (this.mode & BigInt(S_IFMT)) === BigInt(kind);
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

function bigintColumn(columns: string[], index: number): bigint {
  const value = columns[index];
  if (value === undefined) {
    throw new Error(`fs bigint stat result is missing column ${index}`);
  }
  return BigInt(value);
}

export function isBigIntStats(stats: Stats | BigIntStats): stats is BigIntStats {
  return typeof stats.mode === "bigint";
}

export interface StatFsOptions {
  bigint?: boolean;
}

/** Filesystem-capacity information returned by `statfs`. */
export class StatFs<Value extends number | bigint = number> {
  type: Value;
  bsize: Value;
  frsize: Value;
  blocks: Value;
  bfree: Value;
  bavail: Value;
  files: Value;
  ffree: Value;

  constructor(
    type: Value,
    bsize: Value,
    frsize: Value,
    blocks: Value,
    bfree: Value,
    bavail: Value,
    files: Value,
    ffree: Value,
  ) {
    this.type = type;
    this.bsize = bsize;
    this.frsize = frsize;
    this.blocks = blocks;
    this.bfree = bfree;
    this.bavail = bavail;
    this.files = files;
    this.ffree = ffree;
  }
}

export function isBigIntStatFs(
  stats: StatFs<number> | StatFs<bigint>,
): stats is StatFs<bigint> {
  return typeof stats.type === "bigint";
}

function numberStatFsColumn(columns: number[], index: number): number {
  const value = columns[index];
  if (value === undefined) {
    throw new Error(`fs statfs result is missing column ${index}`);
  }
  return value;
}

function bigintStatFsColumn(columns: string[], index: number): bigint {
  const value = columns[index];
  if (value === undefined) {
    throw new Error(`fs statfs bigint result is missing column ${index}`);
  }
  return BigInt(value);
}

export function numberStatFs(columns: number[]): StatFs<number> {
  return new StatFs(
    numberStatFsColumn(columns, 0),
    numberStatFsColumn(columns, 1),
    numberStatFsColumn(columns, 2),
    numberStatFsColumn(columns, 3),
    numberStatFsColumn(columns, 4),
    numberStatFsColumn(columns, 5),
    numberStatFsColumn(columns, 6),
    numberStatFsColumn(columns, 7),
  );
}

export function bigintStatFs(columns: string[]): StatFs<bigint> {
  return new StatFs(
    bigintStatFsColumn(columns, 0),
    bigintStatFsColumn(columns, 1),
    bigintStatFsColumn(columns, 2),
    bigintStatFsColumn(columns, 3),
    bigintStatFsColumn(columns, 4),
    bigintStatFsColumn(columns, 5),
    bigintStatFsColumn(columns, 6),
    bigintStatFsColumn(columns, 7),
  );
}

/** `readdirSync(dir, { withFileTypes: true })`. */
export class Dirent<Name extends string | Buffer = string> {
  name: Name;
  parentPath: string;
  private type: number;

  constructor(name: Name, type: number, parentPath: string) {
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
