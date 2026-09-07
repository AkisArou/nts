import { encodeByteString, latin1 } from "../core/encoding.ts";
import { LimitError, ProtocolError } from "../core/errors.ts";
import {
  decodeHpackHuffman,
  encodeHpackHuffman,
  hpackHuffmanEncodedLength,
} from "./hpack-huffman.ts";

export type HpackIndexing = "incremental" | "without" | "never";

export interface HpackHeaderField {
  readonly name: string;
  readonly value: string;
  readonly indexing?: HpackIndexing;
}

export interface DecodedHpackHeaderField {
  readonly name: string;
  readonly value: string;
  readonly neverIndexed: boolean;
}

export interface HpackLimits {
  readonly maxHeaderListBytes: number;
  readonly maxStringBytes: number;
}

export const defaultHpackLimits: HpackLimits = {
  maxHeaderListBytes: 64 * 1024,
  maxStringBytes: 64 * 1024,
};

interface StoredHeader {
  readonly name: string;
  readonly value: string;
  readonly size: number;
}

interface Cursor {
  readonly bytes: Uint8Array;
  offset: number;
}

const STATIC_NAMES: readonly string[] = [
  ":authority",
  ":method",
  ":method",
  ":path",
  ":path",
  ":scheme",
  ":scheme",
  ":status",
  ":status",
  ":status",
  ":status",
  ":status",
  ":status",
  ":status",
  "accept-charset",
  "accept-encoding",
  "accept-language",
  "accept-ranges",
  "accept",
  "access-control-allow-origin",
  "age",
  "allow",
  "authorization",
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-language",
  "content-length",
  "content-location",
  "content-range",
  "content-type",
  "cookie",
  "date",
  "etag",
  "expect",
  "expires",
  "from",
  "host",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "last-modified",
  "link",
  "location",
  "max-forwards",
  "proxy-authenticate",
  "proxy-authorization",
  "range",
  "referer",
  "refresh",
  "retry-after",
  "server",
  "set-cookie",
  "strict-transport-security",
  "transfer-encoding",
  "user-agent",
  "vary",
  "via",
  "www-authenticate",
];

const STATIC_VALUES: readonly string[] = [
  "",
  "GET",
  "POST",
  "/",
  "/index.html",
  "http",
  "https",
  "200",
  "204",
  "206",
  "304",
  "400",
  "404",
  "500",
  "",
  "gzip, deflate",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
];

const STATIC_TABLE_LENGTH = 61;
const MAX_HPACK_INTEGER = 0x7fffffff;

function requireNonnegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_HPACK_INTEGER) {
    throw new RangeError(name + " must be an integer between 0 and 2^31-1");
  }
}

function byteStringLength(value: string): number {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 255) throw new TypeError("HPACK fields must be ByteStrings");
  }
  return value.length;
}

function entrySize(name: string, value: string): number {
  return byteStringLength(name) + byteStringLength(value) + 32;
}

function staticEntry(index: number): StoredHeader | null {
  if (index < 1 || index > STATIC_TABLE_LENGTH) return null;
  const name = STATIC_NAMES[index - 1];
  const value = STATIC_VALUES[index - 1];
  if (name === undefined || value === undefined) return null;
  return { name, value, size: name.length + value.length + 32 };
}

class DynamicTable {
  private readonly stored: StoredHeader[] = [];
  private storedBytes = 0;
  private capacityBytes: number;

  constructor(capacity: number) {
    this.capacityBytes = capacity;
  }

  get length(): number {
    return this.stored.length;
  }

  get size(): number {
    return this.storedBytes;
  }

  get capacity(): number {
    return this.capacityBytes;
  }

  get(index: number): StoredHeader | null {
    return this.stored[index - 1] ?? null;
  }

  setCapacity(capacity: number): void {
    this.capacityBytes = capacity;
    this.evictTo(capacity);
  }

  insert(name: string, value: string): void {
    const size = entrySize(name, value);
    if (size > this.capacityBytes) {
      this.stored.length = 0;
      this.storedBytes = 0;
      return;
    }
    this.evictTo(this.capacityBytes - size);
    this.stored.unshift({ name, value, size });
    this.storedBytes += size;
  }

  find(name: string, value: string): number {
    for (let i = 0; i < this.stored.length; i++) {
      const entry = this.stored[i];
      if (entry !== undefined && entry.name === name && entry.value === value) return i + 1;
    }
    return 0;
  }

  findName(name: string): number {
    for (let i = 0; i < this.stored.length; i++) {
      if (this.stored[i]?.name === name) return i + 1;
    }
    return 0;
  }

  private evictTo(target: number): void {
    while (this.storedBytes > target && this.stored.length !== 0) {
      const removed = this.stored.pop();
      if (removed !== undefined) this.storedBytes -= removed.size;
    }
  }
}

function readByte(cursor: Cursor): number {
  const byte = cursor.bytes[cursor.offset++];
  if (byte === undefined) throw new ProtocolError("Truncated HPACK block");
  return byte;
}

export function decodeHpackInteger(cursor: Cursor, prefixBits: number): number {
  if (prefixBits < 1 || prefixBits > 8) throw new RangeError("Invalid HPACK prefix width");
  const prefixMask = 2 ** prefixBits - 1;
  const first = readByte(cursor);
  let value = first & prefixMask;
  if (value < prefixMask) return value;

  let shift = 0;
  for (let octets = 0; octets < 5; octets++) {
    const byte = readByte(cursor);
    const part = (byte & 127) * 2 ** shift;
    if (!Number.isSafeInteger(part) || part > MAX_HPACK_INTEGER - value) {
      throw new ProtocolError("HPACK integer exceeds the supported range");
    }
    value += part;
    if ((byte & 128) === 0) return value;
    shift += 7;
  }
  throw new ProtocolError("HPACK integer encoding is too long");
}

function writeInteger(output: number[], value: number, prefixBits: number, prefix: number): void {
  requireNonnegativeInteger(value, "HPACK integer");
  const prefixMask = 2 ** prefixBits - 1;
  if (value < prefixMask) {
    output.push(prefix | value);
    return;
  }

  output.push(prefix | prefixMask);
  let remainder = value - prefixMask;
  while (remainder >= 128) {
    output.push((remainder % 128) + 128);
    remainder = Math.floor(remainder / 128);
  }
  output.push(remainder);
}

function writeBytes(output: number[], bytes: Uint8Array): void {
  for (const byte of bytes) output.push(byte);
}

function writeString(output: number[], value: string, useHuffman: boolean): void {
  const bytes = encodeByteString(value);
  const encodedLength = hpackHuffmanEncodedLength(bytes);
  if (useHuffman && encodedLength < bytes.length) {
    const encoded = encodeHpackHuffman(bytes);
    writeInteger(output, encoded.length, 7, 128);
    writeBytes(output, encoded);
    return;
  }
  writeInteger(output, bytes.length, 7, 0);
  writeBytes(output, bytes);
}

function readString(cursor: Cursor, limits: HpackLimits): string {
  const huffman = ((cursor.bytes[cursor.offset] ?? 0) & 128) !== 0;
  const length = decodeHpackInteger(cursor, 7);
  if (length > limits.maxStringBytes) {
    throw new LimitError("Encoded HPACK string exceeds configured limit");
  }
  if (length > cursor.bytes.length - cursor.offset) {
    throw new ProtocolError("Truncated HPACK string");
  }
  const bytes = cursor.bytes.subarray(cursor.offset, cursor.offset + length);
  cursor.offset += length;
  if (!huffman) return latin1(bytes);
  return latin1(decodeHpackHuffman(bytes, limits.maxStringBytes));
}

function findStatic(name: string, value: string): number {
  for (let i = 0; i < STATIC_TABLE_LENGTH; i++) {
    if (STATIC_NAMES[i] === name && STATIC_VALUES[i] === value) return i + 1;
  }
  return 0;
}

function findStaticName(name: string): number {
  for (let i = 0; i < STATIC_TABLE_LENGTH; i++) {
    if (STATIC_NAMES[i] === name) return i + 1;
  }
  return 0;
}

function isSensitiveHeaderName(name: string): boolean {
  return (
    name === "authorization" ||
    name === "proxy-authorization" ||
    name === "cookie" ||
    name === "set-cookie"
  );
}

function resolveIndex(table: DynamicTable, index: number): StoredHeader {
  if (index === 0) throw new ProtocolError("HPACK index zero is invalid");
  const fixed = staticEntry(index);
  if (fixed !== null) return fixed;
  const dynamic = table.get(index - STATIC_TABLE_LENGTH);
  if (dynamic === null) throw new ProtocolError("HPACK index is outside the table");
  return dynamic;
}

function readLiteral(
  cursor: Cursor,
  table: DynamicTable,
  prefixBits: number,
  limits: HpackLimits,
): { name: string; value: string } {
  const nameIndex = decodeHpackInteger(cursor, prefixBits);
  const name = nameIndex === 0 ? readString(cursor, limits) : resolveIndex(table, nameIndex).name;
  return { name, value: readString(cursor, limits) };
}

function validateLimits(limits: HpackLimits): void {
  requireNonnegativeInteger(limits.maxHeaderListBytes, "maxHeaderListBytes");
  requireNonnegativeInteger(limits.maxStringBytes, "maxStringBytes");
}

export class HpackDecoder {
  private readonly table: DynamicTable;
  private maximumAllowedTableSize: number;
  private requiredMinimumSize: number | null = null;
  private readonly limits: HpackLimits;

  constructor(maximumTableSize = 4096, limits: HpackLimits = defaultHpackLimits) {
    requireNonnegativeInteger(maximumTableSize, "maximumTableSize");
    validateLimits(limits);
    this.maximumAllowedTableSize = maximumTableSize;
    this.table = new DynamicTable(maximumTableSize);
    this.limits = limits;
  }

  get dynamicTableSize(): number {
    return this.table.size;
  }

  get dynamicTableLength(): number {
    return this.table.length;
  }

  get dynamicTableCapacity(): number {
    return this.table.capacity;
  }

  setMaximumTableSize(maximum: number): void {
    requireNonnegativeInteger(maximum, "maximumTableSize");
    if (maximum < this.table.capacity) {
      this.requiredMinimumSize = Math.min(this.requiredMinimumSize ?? maximum, maximum);
    }
    this.maximumAllowedTableSize = maximum;
  }

  decode(block: Uint8Array): DecodedHpackHeaderField[] {
    const cursor: Cursor = { bytes: block, offset: 0 };
    const headers: DecodedHpackHeaderField[] = [];
    let listBytes = 0;
    let sawHeader = false;
    let sizeUpdates = 0;
    let metRequiredMinimum = this.requiredMinimumSize === null;

    while (cursor.offset < block.length) {
      const first = block[cursor.offset] ?? 0;

      if ((first & 128) !== 0) {
        if (!metRequiredMinimum) {
          throw new ProtocolError("HPACK block omitted a required table size update");
        }
        sawHeader = true;
        const entry = resolveIndex(this.table, decodeHpackInteger(cursor, 7));
        listBytes += entry.size;
        if (listBytes > this.limits.maxHeaderListBytes) {
          throw new LimitError("HPACK header list exceeds configured limit");
        }
        headers.push({ name: entry.name, value: entry.value, neverIndexed: false });
        continue;
      }

      if ((first & 64) !== 0) {
        if (!metRequiredMinimum) {
          throw new ProtocolError("HPACK block omitted a required table size update");
        }
        sawHeader = true;
        const field = readLiteral(cursor, this.table, 6, this.limits);
        listBytes += entrySize(field.name, field.value);
        if (listBytes > this.limits.maxHeaderListBytes) {
          throw new LimitError("HPACK header list exceeds configured limit");
        }
        this.table.insert(field.name, field.value);
        headers.push({ ...field, neverIndexed: false });
        continue;
      }

      if ((first & 32) !== 0) {
        if (sawHeader) throw new ProtocolError("HPACK table size update followed a header field");
        sizeUpdates++;
        if (sizeUpdates > 2) throw new ProtocolError("Too many HPACK table size updates");
        const size = decodeHpackInteger(cursor, 5);
        if (size > this.maximumAllowedTableSize) {
          throw new ProtocolError("HPACK table size update exceeds the advertised maximum");
        }
        if (this.requiredMinimumSize !== null && sizeUpdates === 1) {
          if (size > this.requiredMinimumSize) {
            throw new ProtocolError("HPACK table size update omitted the required minimum");
          }
          metRequiredMinimum = true;
        }
        this.table.setCapacity(size);
        continue;
      }

      if (!metRequiredMinimum) {
        throw new ProtocolError("HPACK block omitted a required table size update");
      }
      sawHeader = true;
      const neverIndexed = (first & 16) !== 0;
      const field = readLiteral(cursor, this.table, 4, this.limits);
      listBytes += entrySize(field.name, field.value);
      if (listBytes > this.limits.maxHeaderListBytes) {
        throw new LimitError("HPACK header list exceeds configured limit");
      }
      headers.push({ ...field, neverIndexed });
    }

    if (!metRequiredMinimum) {
      throw new ProtocolError("HPACK block omitted a required table size update");
    }
    this.requiredMinimumSize = null;
    return headers;
  }
}

export class HpackEncoder {
  private readonly table: DynamicTable;
  private pendingMinimumSize: number | null = null;
  private pendingFinalSize: number | null = null;
  private useHuffman: boolean;

  constructor(maximumTableSize = 4096, useHuffman = true) {
    requireNonnegativeInteger(maximumTableSize, "maximumTableSize");
    this.table = new DynamicTable(maximumTableSize);
    this.useHuffman = useHuffman;
  }

  get dynamicTableSize(): number {
    return this.table.size;
  }

  get dynamicTableLength(): number {
    return this.table.length;
  }

  get dynamicTableCapacity(): number {
    return this.table.capacity;
  }

  set huffman(value: boolean) {
    this.useHuffman = value;
  }

  setMaximumTableSize(maximum: number): void {
    requireNonnegativeInteger(maximum, "maximumTableSize");
    this.pendingMinimumSize = Math.min(this.pendingMinimumSize ?? maximum, maximum);
    this.pendingFinalSize = maximum;
    this.table.setCapacity(maximum);
  }

  encode(headers: readonly HpackHeaderField[]): Uint8Array {
    const output: number[] = [];

    if (this.pendingFinalSize !== null) {
      const minimum = this.pendingMinimumSize ?? this.pendingFinalSize;
      writeInteger(output, minimum, 5, 32);
      if (minimum !== this.pendingFinalSize) writeInteger(output, this.pendingFinalSize, 5, 32);
      this.pendingMinimumSize = null;
      this.pendingFinalSize = null;
    }

    for (const field of headers) {
      const name = field.name;
      const value = field.value;
      byteStringLength(name);
      byteStringLength(value);
      const indexing = field.indexing ?? (isSensitiveHeaderName(name) ? "never" : "incremental");

      if (indexing === "incremental") {
        const fixed = findStatic(name, value);
        const dynamic = fixed === 0 ? this.table.find(name, value) : 0;
        const exact = fixed !== 0 ? fixed : dynamic === 0 ? 0 : STATIC_TABLE_LENGTH + dynamic;
        if (exact !== 0) {
          writeInteger(output, exact, 7, 128);
          continue;
        }
      }

      const fixedName = findStaticName(name);
      const dynamicName = fixedName === 0 ? this.table.findName(name) : 0;
      const nameIndex =
        fixedName !== 0 ? fixedName : dynamicName === 0 ? 0 : STATIC_TABLE_LENGTH + dynamicName;
      const prefix = indexing === "incremental" ? 64 : indexing === "never" ? 16 : 0;
      const prefixBits = indexing === "incremental" ? 6 : 4;
      writeInteger(output, nameIndex, prefixBits, prefix);
      if (nameIndex === 0) writeString(output, name, this.useHuffman);
      writeString(output, value, this.useHuffman);
      if (indexing === "incremental") this.table.insert(name, value);
    }
    return new Uint8Array(output);
  }
}
