import { DOMException } from "../core/errors.ts";
import type { CryptoRsaComponents, CryptoRsaOtherPrime } from "../provider/crypto.ts";
import { cryptoByteSubarray, cryptoViewByteLength } from "./buffer-source.ts";

function invalidDer(): never {
  throw new DOMException("The key is not a valid DER encoding", "DataError");
}

/**
 * Web Cryptography §9's exact ASN.1 parser, restricted to the key structures
 * used here. X.690 §§8–11: definite, shortest lengths; primitive integers and
 * strings; minimal signed integers; exact consumption at every boundary.
 * This checks encodings, not RSA arithmetic. The native import owns mathematics.
 */
class DerReader {
  readonly bytes: Uint8Array;
  position: number;
  readonly end: number;

  constructor(bytes: Uint8Array, start = 0, end = cryptoViewByteLength(bytes)) {
    this.bytes = bytes;
    this.position = start;
    this.end = end;
  }

  done(): boolean { return this.position === this.end; }

  complete(): void { if (!this.done()) invalidDer(); }

  peek(): number {
    if (this.position >= this.end) invalidDer();
    return this.bytes[this.position]!;
  }

  read(tag: number): DerReader {
    if (this.position >= this.end || this.bytes[this.position++] !== tag) invalidDer();
    return this.readContent();
  }

  readContent(): DerReader {
    if (this.position >= this.end) invalidDer();
    const first = this.bytes[this.position++]!;
    let length = first;
    if (first >= 0x80) {
      const count = first & 0x7f;
      // A valid in-memory view cannot have a length beyond Number's exact integer
      // range. Bounds below additionally avoid overflow while reading each octet.
      if (count === 0 || count > 6 || count > this.end - this.position || this.bytes[this.position] === 0) invalidDer();
      length = 0;
      for (let index = 0; index < count; index++) length = length * 256 + this.bytes[this.position++]!;
      if (length < 0x80) invalidDer();
    }
    if (length > this.end - this.position) invalidDer();
    const result = new DerReader(this.bytes, this.position, this.position + length);
    this.position += length;
    return result;
  }

  content(): Uint8Array { return cryptoByteSubarray(this.bytes, this.position, this.end); }

  integer(allowZero = false): Uint8Array {
    const value = this.read(0x02);
    const length = value.end - value.position;
    if (length === 0) invalidDer();
    const first = value.bytes[value.position]!;
    if ((first & 0x80) !== 0) invalidDer();
    if (length > 1 && first === 0 && (value.bytes[value.position + 1]! & 0x80) === 0) invalidDer();
    if (!allowZero && length === 1 && first === 0) invalidDer();
    return cryptoByteSubarray(value.bytes, value.position + (length > 1 && first === 0 ? 1 : 0), value.end);
  }
}

const rsaEncryptionOid: readonly number[] = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];

function rsaAlgorithm(reader: DerReader, requireNullParameters: boolean): void {
  const algorithm = reader.read(0x30);
  const oid = algorithm.read(0x06).content();
  if (cryptoViewByteLength(oid) !== rsaEncryptionOid.length) invalidDer();
  for (let index = 0; index < rsaEncryptionOid.length; index++) {
    if (oid[index] !== rsaEncryptionOid[index]) invalidDer();
  }
  // Imports use the generic AlgorithmIdentifier, whose parameters are optional.
  // If present, rsaEncryption defines their type as NULL (RFC 3447 A.1).
  // Exports explicitly require a present NULL in Web Cryptography §§20–22.
  if (requireNullParameters || !algorithm.done()) algorithm.read(0x05).complete();
  algorithm.complete();
}

function readOid(reader: DerReader): void {
  const oid = reader.read(0x06);
  if (oid.done()) invalidDer();
  let first = true;
  while (!oid.done()) {
    const octet = oid.bytes[oid.position++]!;
    if (first && octet === 0x80) invalidDer();
    first = (octet & 0x80) === 0;
  }
  if (!first) invalidDer();
}

function compareEncoding(bytes: Uint8Array, leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): number {
  let left = leftStart;
  let right = rightStart;
  while (left < leftEnd && right < rightEnd) {
    const difference = bytes[left++]! - bytes[right++]!;
    if (difference !== 0) return difference;
  }
  return (leftEnd - left) - (rightEnd - right);
}

class DerValueFrame {
  readonly reader: DerReader;
  readonly ordered: boolean;
  previousStart: number;
  previousEnd: number;

  constructor(reader: DerReader, ordered: boolean) {
    this.reader = reader;
    this.ordered = ordered;
    this.previousStart = -1;
    this.previousEnd = -1;
  }
}

function readAttributeValue(reader: DerReader): DerValueFrame | undefined {
  const tag = reader.peek();
  if ((tag & 0x1f) === 0x1f) {
    reader.position++;
    if (reader.position >= reader.end || reader.bytes[reader.position] === 0x80) invalidDer();
    let number = 0;
    for (;;) {
      if (reader.position >= reader.end) invalidDer();
      const octet = reader.bytes[reader.position++]!;
      // An open type's identity is not otherwise used. Saturating the value
      // avoids a big integer while still rejecting an unnecessary long tag.
      if (number < 31) number = number * 128 + (octet & 0x7f);
      if ((octet & 0x80) === 0) break;
    }
    if (number < 31) invalidDer();
    const value = reader.readContent();
    return (tag & 0x20) !== 0 ? new DerValueFrame(value, false) : undefined;
  }
  if (tag === 0x00) invalidDer();
  const value = reader.read(tag);
  if ((tag & 0x20) !== 0) {
    // DER does not use constructed encodings for primitive universal types.
    if ((tag & 0xc0) === 0 && tag !== 0x30 && tag !== 0x31) invalidDer();
    return new DerValueFrame(value, tag === 0x31);
  }
  if ((tag & 0xc0) !== 0) return undefined;
  const length = value.end - value.position;
  if (tag === 0x10 || tag === 0x11) invalidDer();
  if (tag === 0x01 && (length !== 1 || (value.bytes[value.position] !== 0 && value.bytes[value.position] !== 0xff))) invalidDer();
  if (tag === 0x02 || tag === 0x0a) {
    if (length === 0) invalidDer();
    if (length > 1) {
      const first = value.bytes[value.position]!;
      const second = value.bytes[value.position + 1]!;
      if ((first === 0 && (second & 0x80) === 0) || (first === 0xff && (second & 0x80) !== 0)) invalidDer();
    }
  }
  if (tag === 0x03) {
    if (length === 0) invalidDer();
    const unused = value.bytes[value.position]!;
    if (unused > 7 || (length === 1 && unused !== 0) || (length > 1 && (value.bytes[value.end - 1]! & ((1 << unused) - 1)) !== 0)) invalidDer();
  }
  if (tag === 0x05 && length !== 0) invalidDer();
  if (tag === 0x06) {
    let first = true;
    if (length === 0) invalidDer();
    for (let index = value.position; index < value.end; index++) {
      const octet = value.bytes[index]!;
      if (first && octet === 0x80) invalidDer();
      first = (octet & 0x80) === 0;
    }
    if (!first) invalidDer();
  }
  return undefined;
}

/** Open values may nest deeply; validate iteratively without using the JS stack. */
function attributeValue(reader: DerReader): void {
  const first = readAttributeValue(reader);
  if (first === undefined) return;
  const stack: DerValueFrame[] = [first];
  while (stack.length !== 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.reader.done()) {
      stack.length--;
      continue;
    }
    const start = frame.reader.position;
    const nested = readAttributeValue(frame.reader);
    if (frame.ordered && frame.previousStart >= 0 &&
        compareEncoding(frame.reader.bytes, frame.previousStart, frame.previousEnd, start, frame.reader.position) > 0) invalidDer();
    frame.previousStart = start;
    frame.previousEnd = frame.reader.position;
    if (nested !== undefined) stack[stack.length] = nested;
  }
}

function attributes(reader: DerReader): void {
  const values = reader.read(0xa0);
  let previousStart = -1;
  let previousEnd = -1;
  while (!values.done()) {
    const start = values.position;
    const attribute = values.read(0x30);
    readOid(attribute);
    const entries = attribute.read(0x31);
    if (entries.done()) invalidDer();
    let previousEntryStart = -1;
    let previousEntryEnd = -1;
    while (!entries.done()) {
      const entryStart = entries.position;
      attributeValue(entries);
      if (previousEntryStart >= 0 && compareEncoding(entries.bytes, previousEntryStart, previousEntryEnd, entryStart, entries.position) > 0) invalidDer();
      previousEntryStart = entryStart;
      previousEntryEnd = entries.position;
    }
    attribute.complete();
    if (previousStart >= 0 && compareEncoding(values.bytes, previousStart, previousEnd, start, values.position) > 0) invalidDer();
    previousStart = start;
    previousEnd = values.position;
  }
}

function publicComponents(reader: DerReader): CryptoRsaComponents {
  const key = reader.read(0x30);
  reader.complete();
  const n = key.integer();
  const e = key.integer();
  key.complete();
  return { family: "RSA", n, e };
}

function privateComponents(reader: DerReader): CryptoRsaComponents {
  const key = reader.read(0x30);
  reader.complete();
  const version = key.integer(true);
  if (cryptoViewByteLength(version) !== 1 || (version[0] !== 0 && version[0] !== 1)) invalidDer();
  const n = key.integer();
  const e = key.integer();
  const d = key.integer();
  const p = key.integer();
  const q = key.integer();
  const dp = key.integer();
  const dq = key.integer();
  const qi = key.integer();
  if (version[0] === 0) {
    key.complete();
    return { family: "RSA", n, e, d, p, q, dp, dq, qi };
  }
  const others = key.read(0x30);
  if (others.done()) invalidDer();
  const oth: CryptoRsaOtherPrime[] = [];
  while (!others.done()) {
    const prime = others.read(0x30);
    const r = prime.integer();
    const factorExponent = prime.integer();
    const t = prime.integer();
    prime.complete();
    oth[oth.length] = { r, d: factorExponent, t };
  }
  key.complete();
  return { family: "RSA", n, e, d, p, q, dp, dq, qi, oth };
}

/** Exact SPKI/PKCS #8 envelopes plus the embedded PKCS #1 key structure. */
export function parseRsaDer(format: "spki" | "pkcs8", bytes: Uint8Array, requireNullParameters = false): CryptoRsaComponents {
  const source = new DerReader(bytes);
  const envelope = source.read(0x30);
  source.complete();
  if (format === "spki") {
    rsaAlgorithm(envelope, requireNullParameters);
    const publicKey = envelope.read(0x03);
    if (publicKey.done() || publicKey.bytes[publicKey.position++] !== 0) invalidDer();
    envelope.complete();
    return publicComponents(publicKey);
  }
  const version = envelope.integer(true);
  if (cryptoViewByteLength(version) !== 1 || version[0] !== 0) invalidDer();
  rsaAlgorithm(envelope, requireNullParameters);
  const privateKey = envelope.read(0x04);
  if (!envelope.done()) attributes(envelope);
  envelope.complete();
  return privateComponents(privateKey);
}
