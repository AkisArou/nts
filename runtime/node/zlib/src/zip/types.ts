// Static records for Node v26.13.0 internal/zip. These annotations add no
// validation or state changes to the transcribed bodies.
import type { Buffer } from "../../../buffer/src/main.ts";
import type { CentralFileHeader } from "./headers.ts";
import type { ZipEntry } from "./entry.ts";

export interface ZipEntryOptions {
  comment?: string | undefined;
  mode?: number | undefined;
  modified?: Date | undefined;
  method?: "deflate" | "store" | "zstd" | undefined;
  symlink?: boolean | undefined;
}

export interface ZipReadOptions {
  verify?: boolean | undefined;
  maxSize?: number | undefined;
}

export interface ZipArchiveOptions {
  comment?: string | Buffer | undefined;
  baseOffset?: number | undefined;
  followSymlinks?: boolean | undefined;
}
export type ZipArchiveInput = string | ZipArchiveOptions;
export type ZipEntries = Iterable<ZipEntry> | AsyncIterable<ZipEntry>;
export type ZipFileSources = Iterable<readonly [string, string]> | AsyncIterable<readonly [string, string]>;

export type ZipSource = (AsyncIterable<unknown> | Iterable<unknown>) & {
  destroy?: (() => unknown) | undefined;
  return?: (() => unknown) | undefined;
  [Symbol.asyncDispose]?: (() => PromiseLike<void>) | undefined;
};

export interface ZipMeta {
  name: Buffer;
  comment: Buffer;
  extra: Buffer;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  modified: Date;
  extendedMtime: number | null;
  external: number;
  internal: number;
  madeBy: number;
  pending: boolean;
}

export interface ZipMemberInfo {
  name: string;
  flags: number;
  method: number;
  crc32: number;
  uncompressedSize: number;
}

export interface Zip64Want {
  uncompressedSize: boolean;
  compressedSize: boolean;
  localFileHeaderOffset: boolean;
  diskNumber: boolean;
}
export interface Zip64Extra {
  uncompressedSize?: number;
  compressedSize?: number;
  localFileHeaderOffset?: number;
  diskNumber?: number;
}

export interface ArchiveEnd {
  prefix: number;
  totalRecords: number;
  centralDirectoryOffset: number;
  centralDirectorySize: number;
  comment: Buffer;
  needTailFrom?: undefined;
}
export interface ArchiveTailRequest {
  needTailFrom: number;
  prefix?: undefined;
  totalRecords?: undefined;
  centralDirectoryOffset?: undefined;
  centralDirectorySize?: undefined;
  comment?: undefined;
}
export type ArchiveEndResult = ArchiveEnd | ArchiveTailRequest;

export interface ZipHandle {
  fd: number;
  closed: boolean;
  closing: boolean;
  reads: number;
  drain: (() => void) | null;
}
export interface FileEntryInfo {
  central: CentralFileHeader | null;
  entry: ZipEntry | undefined;
  localOffset: number;
}
export interface CentralRecord {
  entry: ZipEntry;
  localOffset: number;
}
export interface MemberRange {
  fileName: string;
  offset: number;
  dataEnd: number;
}
export interface ParsedEntry {
  entry: ZipEntry;
  start: number;
  dataEnd: number;
}
export interface DecodeError {
  message: string;
  code?: string | undefined;
}
export interface ZipFileOpenOptions {
  writable?: boolean | undefined;
}
