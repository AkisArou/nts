import { DOMException } from "../core/errors.ts";
import { utf8Decode } from "../core/utf8.ts";
import { coerceToDOMString, requireDictionary } from "../core/webidl.ts";
import { parseJsonText } from "../json/parse.ts";
import type { JsonValue } from "../json/value.ts";
import { cryptoViewByteLength } from "./buffer-source.ts";
import type { KeyUsage } from "./crypto-key.ts";

export type KeyFormat = "raw" | "spki" | "pkcs8" | "jwk";

/** Web Cryptography §15. Fields are optional; algorithms check required members. */
export class RsaOtherPrimesInfo {
  d: string | undefined;
  r: string | undefined;
  t: string | undefined;
}

export class JsonWebKey {
  alg: string | undefined;
  crv: string | undefined;
  d: string | undefined;
  dp: string | undefined;
  dq: string | undefined;
  e: string | undefined;
  ext: boolean | undefined;
  k: string | undefined;
  key_ops: string[] | undefined;
  kty: string | undefined;
  n: string | undefined;
  oth: RsaOtherPrimesInfo[] | undefined;
  p: string | undefined;
  q: string | undefined;
  qi: string | undefined;
  use: string | undefined;
  x: string | undefined;
  y: string | undefined;
}

export interface RsaOtherPrimesInfoObject {
  d?: string;
  r?: string;
  t?: string;
}

/** A fresh ordinary object returned by exportKey, without internal aliases. */
export interface JsonWebKeyObject {
  alg?: string;
  crv?: string;
  d?: string;
  dp?: string;
  dq?: string;
  e?: string;
  ext?: boolean;
  k?: string;
  key_ops?: string[];
  kty?: string;
  n?: string;
  oth?: RsaOtherPrimesInfoObject[];
  p?: string;
  q?: string;
  qi?: string;
  use?: string;
  x?: string;
  y?: string;
}

interface JsonWebKeyInput {
  readonly alg?: unknown;
  readonly crv?: unknown;
  readonly d?: unknown;
  readonly dp?: unknown;
  readonly dq?: unknown;
  readonly e?: unknown;
  readonly ext?: unknown;
  readonly k?: unknown;
  readonly key_ops?: unknown;
  readonly kty?: unknown;
  readonly n?: unknown;
  readonly oth?: unknown;
  readonly p?: unknown;
  readonly q?: unknown;
  readonly qi?: unknown;
  readonly use?: unknown;
  readonly x?: unknown;
  readonly y?: unknown;
}

const call = Function.prototype.call.bind(Function.prototype.call) as
  (callback: Function, receiver: unknown, ...args: unknown[]) => unknown;
const ByteArray = Uint8Array;
const push = Array.prototype.push;
const charCodeAt = String.prototype.charCodeAt;
const slice = String.prototype.slice;
const floor = Math.floor;
const base64url = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const hexadecimal = "0123456789abcdef";
const usageOrder: readonly KeyUsage[] = [
  "encrypt", "decrypt", "sign", "verify", "deriveKey", "deriveBits", "wrapKey", "unwrapKey",
];

function append<T>(values: T[], value: T): void {
  call(push, values, value);
}

function codeUnit(value: string, index: number): number {
  return call(charCodeAt, value, index) as number;
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/** Web IDL sequence conversion captures next once and does not IteratorClose. */
function sequence<T>(value: unknown, convert: (item: unknown) => T): T[] {
  if (!isObject(value)) throw new TypeError("A sequence must be an iterable object");
  const method = (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator];
  if (typeof method !== "function") throw new TypeError("A sequence must be iterable");
  const iterator = call(method, value);
  if (!isObject(iterator)) throw new TypeError("The iterator must be an object");
  const next = (iterator as { readonly next?: unknown }).next;
  if (typeof next !== "function") throw new TypeError("The iterator next must be callable");
  const result: T[] = [];
  for (;;) {
    const step = call(next, iterator);
    if (!isObject(step)) throw new TypeError("An iterator result must be an object");
    if ((step as { readonly done?: unknown }).done) return result;
    const item = (step as { readonly value?: unknown }).value;
    append(result, convert(item));
  }
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : coerceToDOMString(value);
}

function otherPrime(value: unknown): RsaOtherPrimesInfo {
  requireDictionary(value, "RsaOtherPrimesInfo");
  const result = new RsaOtherPrimesInfo();
  if (value === null || value === undefined) return result;
  const source = value as { readonly d?: unknown; readonly r?: unknown; readonly t?: unknown };
  result.d = optionalString(source.d);
  result.r = optionalString(source.r);
  result.t = optionalString(source.t);
  return result;
}

/** Convert every declared member in Web IDL's lexicographic order, once each. */
export function toJsonWebKey(value: unknown): JsonWebKey {
  requireDictionary(value, "JsonWebKey");
  const result = new JsonWebKey();
  if (value === null || value === undefined) return result;
  const source = value as JsonWebKeyInput;
  result.alg = optionalString(source.alg);
  result.crv = optionalString(source.crv);
  result.d = optionalString(source.d);
  result.dp = optionalString(source.dp);
  result.dq = optionalString(source.dq);
  result.e = optionalString(source.e);
  const extractable = source.ext;
  if (extractable !== undefined) result.ext = !!extractable;
  result.k = optionalString(source.k);
  const operations = source.key_ops;
  if (operations !== undefined) result.key_ops = sequence(operations, coerceToDOMString);
  result.kty = optionalString(source.kty);
  result.n = optionalString(source.n);
  const primes = source.oth;
  if (primes !== undefined) result.oth = sequence(primes, otherPrime);
  result.p = optionalString(source.p);
  result.q = optionalString(source.q);
  result.qi = optionalString(source.qi);
  result.use = optionalString(source.use);
  result.x = optionalString(source.x);
  result.y = optionalString(source.y);
  return result;
}

export function toJsonWebKeyObject(key: JsonWebKey): JsonWebKeyObject {
  let operations: string[] | undefined;
  if (key.key_ops !== undefined) {
    operations = [];
    for (let index = 0; index < key.key_ops.length; index++) append(operations, key.key_ops[index]!);
  }
  // Exported symmetric keys take the ordinary-object literal path. Literals
  // create own data properties without consulting inherited field setters.
  if (key.kty === "oct" && key.alg !== undefined && key.ext !== undefined &&
      key.k !== undefined && operations !== undefined && key.crv === undefined &&
      key.d === undefined && key.dp === undefined && key.dq === undefined &&
      key.e === undefined && key.n === undefined && key.oth === undefined &&
      key.p === undefined && key.q === undefined && key.qi === undefined &&
      key.use === undefined && key.x === undefined && key.y === undefined) {
    return { alg: key.alg, ext: key.ext, k: key.k, key_ops: operations, kty: key.kty };
  }
  let primes: RsaOtherPrimesInfoObject[] | undefined;
  if (key.oth !== undefined) {
    primes = [];
    for (let index = 0; index < key.oth.length; index++) {
      const prime = key.oth[index]!;
      const copy: RsaOtherPrimesInfoObject = { d: prime.d, r: prime.r, t: prime.t };
      if (copy.d === undefined) delete copy.d;
      if (copy.r === undefined) delete copy.r;
      if (copy.t === undefined) delete copy.t;
      append(primes, copy);
    }
  }
  const result: JsonWebKeyObject = {
    alg: key.alg, crv: key.crv, d: key.d, dp: key.dp, dq: key.dq, e: key.e,
    ext: key.ext, k: key.k, key_ops: operations, kty: key.kty, n: key.n, oth: primes,
    p: key.p, q: key.q, qi: key.qi, use: key.use, x: key.x, y: key.y,
  };
  if (result.alg === undefined) delete result.alg;
  if (result.crv === undefined) delete result.crv;
  if (result.d === undefined) delete result.d;
  if (result.dp === undefined) delete result.dp;
  if (result.dq === undefined) delete result.dq;
  if (result.e === undefined) delete result.e;
  if (result.ext === undefined) delete result.ext;
  if (result.k === undefined) delete result.k;
  if (result.key_ops === undefined) delete result.key_ops;
  if (result.kty === undefined) delete result.kty;
  if (result.n === undefined) delete result.n;
  if (result.oth === undefined) delete result.oth;
  if (result.p === undefined) delete result.p;
  if (result.q === undefined) delete result.q;
  if (result.qi === undefined) delete result.qi;
  if (result.use === undefined) delete result.use;
  if (result.x === undefined) delete result.x;
  if (result.y === undefined) delete result.y;
  return result;
}

export function toKeyFormat(value: unknown): KeyFormat {
  const format = coerceToDOMString(value);
  if (format === "raw" || format === "spki" || format === "pkcs8" || format === "jwk") return format;
  throw new TypeError("Unknown key format");
}

function keyUsage(value: unknown): KeyUsage {
  const usage = coerceToDOMString(value);
  for (let index = 0; index < usageOrder.length; index++) {
    if (usage === usageOrder[index]) return usageOrder[index]!;
  }
  throw new TypeError("Unknown key usage");
}

export function toKeyUsages(value: unknown): KeyUsage[] {
  return sequence(value, keyUsage);
}

/** §9 usage normalization: remove duplicates and use the enum's defined order. */
export function normalizeKeyUsages(usages: readonly KeyUsage[]): KeyUsage[] {
  const result: KeyUsage[] = [];
  for (let order = 0; order < usageOrder.length; order++) {
    const usage = usageOrder[order]!;
    for (let index = 0; index < usages.length; index++) {
      if (usages[index] === usage) {
        append(result, usage);
        break;
      }
    }
  }
  return result;
}

function base64Digit(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97 + 26;
  if (code >= 48 && code <= 57) return code - 48 + 52;
  if (code === 45) return 62;
  if (code === 95) return 63;
  return -1;
}

/** RFC 7515 §2: URL alphabet, no padding or whitespace. */
export function decodeBase64Url(value: string): Uint8Array {
  if (value.length % 4 === 1) throw new DOMException("Invalid base64url length", "DataError");
  const result = new ByteArray(floor(value.length * 6 / 8));
  let accumulator = 0;
  let bits = 0;
  let output = 0;
  for (let index = 0; index < value.length; index++) {
    const digit = base64Digit(codeUnit(value, index));
    if (digit < 0) throw new DOMException("Invalid base64url character", "DataError");
    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      result[output++] = (accumulator >>> bits) & 255;
    }
  }
  // RFC 4648 §3.5 permits, but does not require, rejecting nonzero unused pad
  // bits. JWK imposes no stricter decoding requirement; exporters are canonical.
  return result;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let result = "";
  const length = cryptoViewByteLength(bytes);
  for (let index = 0; index < length; index += 3) {
    const a = bytes[index]!;
    const b = index + 1 < length ? bytes[index + 1]! : 0;
    const c = index + 2 < length ? bytes[index + 2]! : 0;
    result += base64url[a >>> 2]! + base64url[((a & 3) << 4) | (b >>> 4)]!;
    if (index + 1 < length) result += base64url[((b & 15) << 2) | (c >>> 6)]!;
    if (index + 2 < length) result += base64url[c & 63]!;
  }
  return result;
}

function member(node: JsonValue, name: string): JsonValue | undefined {
  if (node.kind !== "object") return undefined;
  for (let index = 0; index < node.keys.length; index++) {
    if (node.keys[index] === name) return node.values[index];
  }
  return undefined;
}

function jsonScalarString(node: JsonValue): string {
  switch (node.kind) {
    case "null": return "null";
    case "boolean": return node.boolean ? "true" : "false";
    case "number": return coerceToDOMString(node.number);
    case "string": return node.text;
    case "object":
      // JSON cannot contain a callable own toString. Without one, a clean
      // realm's ordinary Object.prototype.toString returns this built-in tag.
      if (member(node, "toString") !== undefined) throw new TypeError("Cannot convert object to string");
      return "[object Object]";
    default: throw new TypeError("Unexpected JSON value for scalar conversion");
  }
}

class JsonArrayStringFrame {
  readonly node: JsonValue;
  index: number;

  constructor(node: JsonValue) {
    this.node = node;
    this.index = 0;
  }
}

/** DOMString conversion as if JSON.parse had created values in a fresh realm. */
function jsonString(node: JsonValue): string {
  if (node.kind !== "array") return jsonScalarString(node);
  let result = "";
  const frames: JsonArrayStringFrame[] = [new JsonArrayStringFrame(node)];
  while (frames.length !== 0) {
    const frame = frames[frames.length - 1]!;
    if (frame.index === frame.node.items.length) {
      frames.length--;
      continue;
    }
    if (frame.index !== 0) result += ",";
    const item = frame.node.items[frame.index++]!;
    if (item.kind === "null") continue;
    if (item.kind === "array") append(frames, new JsonArrayStringFrame(item));
    else result += jsonScalarString(item);
  }
  return result;
}

function optionalJsonString(node: JsonValue | undefined): string | undefined {
  return node === undefined ? undefined : jsonString(node);
}

function jsonBoolean(node: JsonValue): boolean {
  switch (node.kind) {
    case "null": return false;
    case "boolean": return node.boolean;
    case "number": return node.number !== 0;
    case "string": return node.text.length !== 0;
    case "array":
    case "object": return true;
    default: throw new TypeError("Unexpected JSON value for boolean conversion");
  }
}

function jsonDictionary(node: JsonValue): void {
  if (node.kind !== "object" && node.kind !== "array" && node.kind !== "null") {
    throw new TypeError("JSON value cannot be converted to a dictionary");
  }
}

function jsonOtherPrime(node: JsonValue): RsaOtherPrimesInfo {
  jsonDictionary(node);
  const result = new RsaOtherPrimesInfo();
  result.d = optionalJsonString(member(node, "d"));
  result.r = optionalJsonString(member(node, "r"));
  result.t = optionalJsonString(member(node, "t"));
  return result;
}

/** §9 parse a JWK: UTF-8 decode, fresh-realm JSON parsing, then IDL conversion. */
export function parseWrappedJwk(bytes: Uint8Array): JsonWebKey {
  let text = utf8Decode(bytes, 0, cryptoViewByteLength(bytes));
  if (codeUnit(text, 0) === 0xfeff) text = call(slice, text, 1) as string;
  const node = parseJsonText(text);
  jsonDictionary(node);
  const result = new JsonWebKey();
  result.alg = optionalJsonString(member(node, "alg"));
  result.crv = optionalJsonString(member(node, "crv"));
  result.d = optionalJsonString(member(node, "d"));
  result.dp = optionalJsonString(member(node, "dp"));
  result.dq = optionalJsonString(member(node, "dq"));
  result.e = optionalJsonString(member(node, "e"));
  const extractable = member(node, "ext");
  if (extractable !== undefined) result.ext = jsonBoolean(extractable);
  result.k = optionalJsonString(member(node, "k"));
  const operations = member(node, "key_ops");
  if (operations !== undefined) {
    if (operations.kind !== "array") throw new TypeError("key_ops must be a sequence");
    const usages: string[] = [];
    for (let index = 0; index < operations.items.length; index++) append(usages, jsonString(operations.items[index]!));
    result.key_ops = usages;
  }
  result.kty = optionalJsonString(member(node, "kty"));
  result.n = optionalJsonString(member(node, "n"));
  const primes = member(node, "oth");
  if (primes !== undefined) {
    if (primes.kind !== "array") throw new TypeError("oth must be a sequence");
    const others: RsaOtherPrimesInfo[] = [];
    for (let index = 0; index < primes.items.length; index++) append(others, jsonOtherPrime(primes.items[index]!));
    result.oth = others;
  }
  result.p = optionalJsonString(member(node, "p"));
  result.q = optionalJsonString(member(node, "q"));
  result.qi = optionalJsonString(member(node, "qi"));
  result.use = optionalJsonString(member(node, "use"));
  result.x = optionalJsonString(member(node, "x"));
  result.y = optionalJsonString(member(node, "y"));
  if (result.kty === undefined) throw new DOMException("The JWK has no kty member", "DataError");
  return result;
}

function quoteAscii(value: string): string {
  let result = '"';
  for (let index = 0; index < value.length; index++) {
    const code = codeUnit(value, index);
    if (code === 34) result += '\\"';
    else if (code === 92) result += "\\\\";
    else if (code === 8) result += "\\b";
    else if (code === 9) result += "\\t";
    else if (code === 10) result += "\\n";
    else if (code === 12) result += "\\f";
    else if (code === 13) result += "\\r";
    else if (code < 32 || code > 126) {
      result += "\\u" + hexadecimal[code >>> 12]! + hexadecimal[(code >>> 8) & 15]!
        + hexadecimal[(code >>> 4) & 15]! + hexadecimal[code & 15]!;
    } else result += value[index];
  }
  return result + '"';
}

/** Serialize the generated oct JWK without observable toJSON/prototype hooks. */
export function serializeWrappedJwk(key: JsonWebKey, padToEight: boolean): Uint8Array {
  if (key.kty !== "oct" || key.k === undefined) throw new TypeError("Expected an exported oct JWK");
  // Match dictionary-to-object member order. Only these fields are generated for
  // HMAC and AES; no caller-owned objects or stringifier callbacks are consulted.
  let text = "{";
  if (key.alg !== undefined) text += '"alg":' + quoteAscii(key.alg) + ",";
  if (key.ext !== undefined) text += '"ext":' + (key.ext ? "true" : "false") + ",";
  text += '"k":' + quoteAscii(key.k) + ",";
  if (key.key_ops !== undefined) {
    text += '"key_ops":[';
    for (let index = 0; index < key.key_ops.length; index++) {
      if (index !== 0) text += ",";
      text += quoteAscii(key.key_ops[index]!);
    }
    text += "],";
  }
  text += '"kty":"oct"}';
  // §14.3.11 expressly permits adapting JWK serialization to AES-KW's size.
  if (padToEight) while (text.length % 8 !== 0) text += " ";
  const result = new ByteArray(text.length);
  for (let index = 0; index < text.length; index++) result[index] = codeUnit(text, index);
  return result;
}
