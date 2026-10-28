import { Buffer } from "node:buffer";
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  createSecretKey,
  diffieHellman,
  ECDH,
  generateKeyPairSync,
  hkdfSync,
  pbkdf2Sync,
  privateDecrypt,
  publicEncrypt,
  sign,
  timingSafeEqual,
  verify,
} from "node:crypto";
import type { CipherGCMTypes, KeyObject } from "node:crypto";
import type {
  CryptoAesCtrParameters,
  CryptoCipherParameters,
  CryptoCiphertext,
  CryptoDerivationParameters,
  CryptoDigestName,
  CryptoEcComponents,
  CryptoFailure,
  CryptoKeyComponents,
  CryptoKeyHandle,
  CryptoKeyImport,
  CryptoKeyPairGeneration,
  CryptoKeyPairRecord,
  CryptoKeyRecord,
  CryptoNamedCurve,
  CryptoOkpComponents,
  CryptoOkpCurve,
  CryptoProvider,
  CryptoRsaComponents,
  CryptoRsaOtherPrime,
  CryptoSignature,
  CryptoSignatureParameters,
} from "../src/provider/crypto.ts";

const ByteArray = Uint8Array;
// Test adapters need the same native-slot behavior as OpenSSL/JCA bindings even
// when a caller passes a typed-array subclass with shadowing author accessors.
const typedArrayPrototype: object = Object.getPrototypeOf(ByteArray.prototype) as object;
const bufferSlot = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const offsetSlot = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const lengthSlot = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const call = Function.prototype.call.bind(Function.prototype.call) as
  (callback: Function, receiver: unknown, ...args: unknown[]) => unknown;
const keyObjects = new WeakMap<CryptoKeyHandle, KeyObject>();
const keyWrapIv = new ByteArray(8).fill(0xa6);
const ceil = Math.ceil;
const floor = Math.floor;
const min = Math.min;
const rsaPkcs1Padding = constants.RSA_PKCS1_PADDING;
const rsaPssPadding = constants.RSA_PKCS1_PSS_PADDING;
const rsaOaepPadding = constants.RSA_PKCS1_OAEP_PADDING;

function hashName(name: CryptoDigestName): string {
  switch (name) {
    case "SHA-1": return "sha1";
    case "SHA-256": return "sha256";
    case "SHA-384": return "sha384";
    case "SHA-512": return "sha512";
    default: return name;
  }
}

function owned(bytes: Uint8Array): Uint8Array {
  // Node Buffers may share a larger allocation. The native contract transfers an
  // independently owned, exactly sized ArrayBuffer for every byte result.
  return new ByteArray(bytes);
}

function byteLength(bytes: Uint8Array): number {
  return call(lengthSlot, bytes) as number;
}

function byteSlice(bytes: Uint8Array, start: number, length: number): Uint8Array {
  return new ByteArray(
    call(bufferSlot, bytes) as ArrayBuffer,
    (call(offsetSlot, bytes) as number) + start,
    length,
  );
}

function secretBits(key: KeyObject): number {
  const size = key.symmetricKeySize;
  if (size === undefined) throw new TypeError("Expected a native secret key");
  return size * 8;
}

function keyRecord(key: KeyObject): CryptoKeyRecord {
  const handle = {} as CryptoKeyHandle;
  keyObjects.set(handle, key);
  if (key.type === "secret") {
    return { handle, info: { family: "secret", type: "secret", length: secretBits(key) } };
  }
  const okpCurve = okpCurveName(key);
  if (okpCurve !== undefined) {
    return { handle, info: { family: "OKP", type: key.type, namedCurve: okpCurve } };
  }
  if (key.asymmetricKeyType === "ec") {
    const nativeCurve = key.asymmetricKeyDetails?.namedCurve;
    if (nativeCurve === undefined) throw new TypeError("Missing native EC metadata");
    return { handle, info: { family: "EC", type: key.type, namedCurve: webCurveName(nativeCurve) } };
  }
  if (key.asymmetricKeyType !== "rsa") throw new TypeError("Expected an unrestricted native RSA key");
  const modulusLength = key.asymmetricKeyDetails?.modulusLength;
  const components = key.export({ format: "jwk" });
  if (modulusLength === undefined || components.e === undefined) throw new TypeError("Missing native RSA metadata");
  return {
    handle,
    info: {
      family: "RSA",
      type: key.type,
      modulusLength,
      publicExponent: owned(Buffer.from(components.e, "base64url")),
    },
  };
}

// The ordinary-Node fixture has no component import/export primitive. Encode
// or decode PKCS #1 only to adapt that native API; shared code independently
// owns the original input's DER and JWK policy. No integer arithmetic or key
// derivation takes place here.
function derValue(tag: number, value: Uint8Array): Buffer {
  const lengthBytes: number[] = [];
  let length = byteLength(value);
  if (length < 128) {
    lengthBytes[0] = length;
  } else {
    while (length !== 0) {
      lengthBytes.unshift(length % 256);
      length = floor(length / 256);
    }
    lengthBytes.unshift(128 + lengthBytes.length);
  }
  return Buffer.concat([Buffer.from([tag, ...lengthBytes]), value]);
}

function derInteger(value: Uint8Array): Buffer {
  const unsigned = byteLength(value) === 0 ? new ByteArray([0]) : value;
  return derValue(2, unsigned[0]! >= 128 ? Buffer.concat([Buffer.from([0]), unsigned]) : unsigned);
}

function rsaComponentsDer(components: CryptoRsaComponents): Buffer {
  const values = [derInteger(components.n), derInteger(components.e)];
  if (components.d === undefined) return derValue(0x30, Buffer.concat(values));
  // Node requires CRT values. Missing-CRT imports are explicitly unavailable in
  // this test adapter; the shared API accepts and forwards n/e/d-only keys to a
  // capable binding. Filling CRT fields with zeros creates an unusable native key.
  if (components.p === undefined || components.q === undefined || components.dp === undefined
    || components.dq === undefined || components.qi === undefined) {
    throw new TypeError("The Node native primitive requires RSA CRT components");
  }
  values.unshift(derInteger(new ByteArray([components.oth === undefined ? 0 : 1])));
  values.push(derInteger(components.d), derInteger(components.p), derInteger(components.q),
    derInteger(components.dp), derInteger(components.dq), derInteger(components.qi));
  if (components.oth !== undefined) {
    const primes: Buffer[] = [];
    for (const prime of components.oth) {
      primes.push(derValue(0x30, Buffer.concat([derInteger(prime.r), derInteger(prime.d), derInteger(prime.t)])));
    }
    values.push(derValue(0x30, Buffer.concat(primes)));
  }
  return derValue(0x30, Buffer.concat(values));
}

class NativeDerReader {
  readonly bytes: Uint8Array;
  offset: number;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.offset = 0;
  }

  read(tag: number): Uint8Array {
    if (this.bytes[this.offset++] !== tag) throw new TypeError("Unexpected native RSA encoding");
    let length = this.bytes[this.offset++]!;
    if (length >= 128) {
      const size = length - 128;
      length = 0;
      for (let index = 0; index < size; index++) length = length * 256 + this.bytes[this.offset++]!;
    }
    const value = byteSlice(this.bytes, this.offset, length);
    this.offset += length;
    return value;
  }

  integer(): Uint8Array {
    const bytes = this.read(2);
    return owned(bytes[0] === 0 && byteLength(bytes) > 1 ? byteSlice(bytes, 1, byteLength(bytes) - 1) : bytes);
  }
}

function rsaComponents(key: KeyObject): CryptoRsaComponents {
  if (key.type === "public") {
    const components = key.export({ format: "jwk" });
    if (components.n === undefined || components.e === undefined) throw new TypeError("Missing native RSA components");
    return { family: "RSA", n: owned(Buffer.from(components.n, "base64url")), e: owned(Buffer.from(components.e, "base64url")) };
  }
  const reader = new NativeDerReader(new NativeDerReader(key.export({ format: "der", type: "pkcs1" })).read(0x30));
  const version = reader.integer()[0]!;
  const n = reader.integer();
  const e = reader.integer();
  const d = reader.integer();
  const p = reader.integer();
  const q = reader.integer();
  const dp = reader.integer();
  const dq = reader.integer();
  const qi = reader.integer();
  if (version === 0) return { family: "RSA", n, e, d, p, q, dp, dq, qi };
  const otherReader = new NativeDerReader(reader.read(0x30));
  const oth: CryptoRsaOtherPrime[] = [];
  while (otherReader.offset < byteLength(otherReader.bytes)) {
    const prime = new NativeDerReader(otherReader.read(0x30));
    oth.push({ r: prime.integer(), d: prime.integer(), t: prime.integer() });
  }
  return { family: "RSA", n, e, d, p, q, dp, dq, qi, oth };
}

function nativeCurveName(curve: CryptoNamedCurve): string {
  switch (curve) {
    case "P-256": return "prime256v1";
    case "P-384": return "secp384r1";
    case "P-521": return "secp521r1";
  }
}

function webCurveName(curve: string): string {
  switch (curve) {
    case "prime256v1": return "P-256";
    case "secp384r1": return "P-384";
    case "secp521r1": return "P-521";
    default: return curve;
  }
}

function ecComponents(key: KeyObject): CryptoEcComponents {
  const components = key.export({ format: "jwk" });
  const { crv, x, y, d } = components;
  if ((crv !== "P-256" && crv !== "P-384" && crv !== "P-521") || x === undefined || y === undefined) {
    throw new TypeError("Unsupported native EC components");
  }
  const publicComponents: CryptoEcComponents = {
    family: "EC", namedCurve: crv,
    x: owned(Buffer.from(x, "base64url")), y: owned(Buffer.from(y, "base64url")),
  };
  return d === undefined ? publicComponents : { ...publicComponents, d: owned(Buffer.from(d, "base64url")) };
}

function ecPoint(components: CryptoEcComponents): Buffer {
  return Buffer.concat([Buffer.from([4]), components.x, components.y]);
}

/**
 * A private KeyObject can retain an unrelated supplied public point. Regenerate
 * its actual point with native EC arithmetic, so the shared layer can compare
 * exportComponents with the original PKCS8/JWK point. The native setter also
 * validates 0 < d < order; there is no scalar or point arithmetic in this adapter.
 */
function ecPrivateKey(curve: string, d: Uint8Array): KeyObject {
  const native = createECDH(curve);
  native.setPrivateKey(d);
  const point = native.getPublicKey();
  const width = (point.byteLength - 1) / 2;
  return createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC", crv: webCurveName(curve), d: Buffer.from(d).toString("base64url"),
      x: point.subarray(1, 1 + width).toString("base64url"),
      y: point.subarray(1 + width).toString("base64url"),
    },
  });
}

function validatedEcKey(key: KeyObject): KeyObject {
  if (key.asymmetricKeyType !== "ec") return key;
  const nativeCurve = key.asymmetricKeyDetails?.namedCurve;
  if (nativeCurve === undefined) throw new TypeError("Missing native EC curve");
  const components = key.export({ format: "jwk" });
  if (key.type === "private") {
    if (components.d === undefined) throw new TypeError("Missing native EC scalar");
    return ecPrivateKey(nativeCurve, Buffer.from(components.d, "base64url"));
  }
  if (components.x === undefined || components.y === undefined) throw new TypeError("Missing native EC point");
  const point = Buffer.concat([
    Buffer.from([4]), Buffer.from(components.x, "base64url"), Buffer.from(components.y, "base64url"),
  ]);
  // Native conversion rejects points outside the curve. All supported curves
  // have cofactor one, so a finite on-curve point has the required subgroup.
  ECDH.convertKey(point, nativeCurve, undefined, undefined, "uncompressed");
  return key;
}

function ecRawKey(curve: CryptoNamedCurve, point: Uint8Array): KeyObject {
  const canonical = ECDH.convertKey(point, nativeCurveName(curve), undefined, undefined, "uncompressed") as Buffer;
  const width = (canonical.byteLength - 1) / 2;
  return createPublicKey({
    format: "jwk",
    key: {
      kty: "EC", crv: curve,
      x: canonical.subarray(1, 1 + width).toString("base64url"),
      y: canonical.subarray(1 + width).toString("base64url"),
    },
  });
}

function ecPkcs8(key: KeyObject): Buffer {
  // Node's PKCS8 export omits ECPrivateKey.parameters. Web Crypto requires both
  // optional SEC1 fields on export. Its native SEC1 export contains both, so wrap
  // those exact native bytes with the same AlgorithmIdentifier, without math.
  const pkcs8 = new NativeDerReader(new NativeDerReader(key.export({ format: "der", type: "pkcs8" })).read(0x30));
  const version = derValue(2, pkcs8.read(2));
  const algorithm = derValue(0x30, pkcs8.read(0x30));
  const privateKey = derValue(4, key.export({ format: "der", type: "sec1" }));
  return derValue(0x30, Buffer.concat([version, algorithm, privateKey]));
}

function minimalInteger(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start + 1 < byteLength(bytes) && bytes[start] === 0) start++;
  return owned(byteSlice(bytes, start, byteLength(bytes) - start));
}

function okpCurveName(key: KeyObject): CryptoOkpCurve | undefined {
  if (key.asymmetricKeyType === "ed25519") return "Ed25519";
  if (key.asymmetricKeyType === "x25519") return "X25519";
  if (key.asymmetricKeyType === "ed448") return "Ed448";
  if (key.asymmetricKeyType === "x448") return "X448";
  return undefined;
}

function okpPublicKey(curve: CryptoOkpCurve, bytes: Uint8Array): KeyObject {
  if (curve !== "Ed25519" && curve !== "X25519" && curve !== "Ed448" && curve !== "X448") {
    throw new TypeError("Unsupported native OKP curve");
  }
  // The native public-key constructor preserves the encoded octets, including
  // noncanonical and small-order encodings. Validation belongs to the operation.
  return createPublicKey({ format: "jwk", key: { kty: "OKP", crv: curve, x: Buffer.from(bytes).toString("base64url") } });
}

function okpPrivateKey(curve: CryptoOkpCurve, seed: Uint8Array): KeyObject {
  if (curve !== "Ed25519" && curve !== "X25519" && curve !== "Ed448" && curve !== "X448") {
    throw new TypeError("Unsupported native OKP curve");
  }
  // RFC 8410's nested OCTET STRING carries the original seed, not the clamped
  // scalar. Native import derives the actual public key from that seed; supplied
  // JWK x is deliberately absent so shared code can perform its consistency check.
  const identifier = curve === "Ed25519" ? 0x70 : curve === "X25519" ? 0x6e : curve === "Ed448" ? 0x71 : 0x6f;
  const oid = derValue(6, new ByteArray([0x2b, 0x65, identifier]));
  const privateKey = derValue(0x30, Buffer.concat([
    derInteger(new ByteArray([0])), derValue(0x30, oid), derValue(4, derValue(4, seed)),
  ]));
  return createPrivateKey({ format: "der", type: "pkcs8", key: privateKey });
}

function okpComponents(key: KeyObject): CryptoOkpComponents {
  const namedCurve = okpCurveName(key);
  const components = key.export({ format: "jwk" });
  if (namedCurve === undefined || components.x === undefined) throw new TypeError("Missing native OKP components");
  const publicComponents: CryptoOkpComponents = {
    family: "OKP", namedCurve, x: owned(Buffer.from(components.x, "base64url")),
  };
  return components.d === undefined ? publicComponents
    : { ...publicComponents, d: owned(Buffer.from(components.d, "base64url")) };
}

/**
 * How many input blocks fit before the requested low-order counter field wraps.
 * Compute the complement plus one, capped at the actual input's block count, so
 * no arbitrary-width integer or loss of Number precision is needed.
 */
function blocksBeforeWrap(counter: Uint8Array, bits: number, blocks: number): number {
  let remainingMinusOne = 0;
  const first = 16 - ceil(bits / 8);
  const firstMask = 255 >>> ((8 - bits % 8) % 8);
  for (let index = first; index < 16; index++) {
    const mask = index === first ? firstMask : 255;
    remainingMinusOne = remainingMinusOne * 256 + ((~counter[index]!) & mask);
    if (remainingMinusOne >= blocks) return blocks;
  }
  return min(blocks, remainingMinusOne + 1);
}

function ctrSpan(key: KeyObject, counter: Uint8Array, data: Uint8Array): Buffer {
  const cipher = createCipheriv(`aes-${secretBits(key)}-ctr`, key, counter);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/**
 * Node's native CTR primitive increments all 128 bits. Adapt its counter field
 * with at most two native whole-span calls, split only at the low-field wrap.
 * No cipher block or keystream generation is implemented in TypeScript.
 */
function ctr(parameters: CryptoAesCtrParameters, key: KeyObject, data: Uint8Array): Uint8Array {
  const inputLength = byteLength(data);
  const blocks = ceil(inputLength / 16);
  const untilWrap = parameters.counterLength === 128
    ? blocks
    : blocksBeforeWrap(parameters.counter, parameters.counterLength, blocks);
  if (untilWrap >= blocks) return owned(ctrSpan(key, parameters.counter, data));

  const split = untilWrap * 16;
  const first = ctrSpan(key, parameters.counter, byteSlice(data, 0, split));
  const resetCounter = new ByteArray(parameters.counter);
  const wholeBytes = floor(parameters.counterLength / 8);
  for (let index = 16 - wholeBytes; index < 16; index++) resetCounter[index] = 0;
  const remainder = parameters.counterLength % 8;
  if (remainder !== 0) {
    const index = 15 - wholeBytes;
    resetCounter[index] = resetCounter[index]! & (255 << remainder);
  }
  const second = ctrSpan(key, resetCounter, byteSlice(data, split, inputLength - split));
  return owned(Buffer.concat([first, second]));
}

/**
 * Test-only native primitives. No Web Crypto implementation is called here.
 * Node's key decoder is not an exhaustive RSA mathematical validator: these
 * tests establish policy/encoding and actual operations, not native check_key
 * behavior. The real bindings must report invalid mathematical material.
 */
export class NodeCryptoProvider implements CryptoProvider {
  digest(algorithm: CryptoDigestName, bytes: Uint8Array): Uint8Array | CryptoFailure {
    try {
      return owned(createHash(hashName(algorithm)).update(bytes).digest());
    } catch {
      return { failure: "operation" };
    }
  }

  importKey(input: CryptoKeyImport): CryptoKeyRecord | CryptoFailure {
    try {
      if (input.format === "raw" && input.family === "secret") {
        return keyRecord(createSecretKey(input.bytes));
      }
      if (input.format === "components" && input.components.family === "secret") {
        return keyRecord(createSecretKey(input.components.k));
      }
      if (input.format === "raw" && input.family === "EC") {
        return keyRecord(ecRawKey(input.namedCurve, input.bytes));
      }
      if (input.format === "raw" && input.family === "OKP") {
        return keyRecord(okpPublicKey(input.namedCurve, input.bytes));
      }
      if (input.format === "spki") {
        return keyRecord(validatedEcKey(createPublicKey({ key: Buffer.from(input.bytes), format: "der", type: "spki" })));
      }
      if (input.format === "pkcs8") {
        return keyRecord(validatedEcKey(createPrivateKey({ key: Buffer.from(input.bytes), format: "der", type: "pkcs8" })));
      }
      if (input.format === "components" && input.components.family === "EC") {
        const components = input.components;
        return keyRecord(components.d === undefined
          ? ecRawKey(components.namedCurve, ecPoint(components))
          : ecPrivateKey(nativeCurveName(components.namedCurve), components.d));
      }
      if (input.format === "components" && input.components.family === "OKP") {
        const components = input.components;
        return keyRecord(components.d === undefined
          ? okpPublicKey(components.namedCurve, components.x)
          : okpPrivateKey(components.namedCurve, components.d));
      }
      if (input.format === "components" && input.components.family === "RSA") {
        const components = input.components;
        if (components.d !== undefined && (components.p === undefined || components.q === undefined
          || components.dp === undefined || components.dq === undefined || components.qi === undefined)) {
          return { failure: "operation" };
        }
        const key = components.d === undefined
          ? createPublicKey({ key: rsaComponentsDer(components), format: "der", type: "pkcs1" })
          : createPrivateKey({ key: rsaComponentsDer(components), format: "der", type: "pkcs1" });
        return keyRecord(key);
      }
      // Other asymmetric families arrive with their separate implementation PRs.
      return { failure: "operation" };
    } catch {
      return { failure: "invalid-key" };
    }
  }

  exportKey(key: CryptoKeyHandle, format: "raw" | "spki" | "pkcs8"): Uint8Array | CryptoFailure {
    try {
      const nativeKey = keyObjects.get(key);
      if (nativeKey === undefined) return { failure: "invalid-key" };
      if (format === "raw" && okpCurveName(nativeKey) !== undefined) {
        if (nativeKey.type !== "public") return { failure: "operation" };
        return okpComponents(nativeKey).x;
      }
      if (nativeKey.asymmetricKeyType === "ec") {
        if (format === "raw") {
          if (nativeKey.type !== "public") return { failure: "operation" };
          return owned(ecPoint(ecComponents(nativeKey)));
        }
        if (format === "pkcs8") return owned(ecPkcs8(nativeKey));
      }
      if (format === "raw") return owned(nativeKey.export());
      return owned(nativeKey.export({ format: "der", type: format }));
    } catch {
      return { failure: "operation" };
    }
  }

  exportComponents(key: CryptoKeyHandle): CryptoKeyComponents | CryptoFailure {
    try {
      const nativeKey = keyObjects.get(key);
      if (nativeKey === undefined) return { failure: "invalid-key" };
      if (nativeKey.type === "secret") return { family: "secret", k: owned(nativeKey.export()) };
      if (okpCurveName(nativeKey) !== undefined) return okpComponents(nativeKey);
      if (nativeKey.asymmetricKeyType === "ec") return ecComponents(nativeKey);
      return rsaComponents(nativeKey);
    } catch {
      return { failure: "operation" };
    }
  }

  generateKeyPair(parameters: CryptoKeyPairGeneration): CryptoKeyPairRecord | CryptoFailure {
    try {
      if (parameters.family === "OKP") {
        const curve = parameters.namedCurve;
        if (curve !== "Ed25519" && curve !== "X25519" && curve !== "Ed448" && curve !== "X448") return { failure: "operation" };
        const pair = curve === "Ed25519" ? generateKeyPairSync("ed25519")
          : curve === "X25519" ? generateKeyPairSync("x25519")
            : curve === "Ed448" ? generateKeyPairSync("ed448") : generateKeyPairSync("x448");
        return { publicKey: keyRecord(pair.publicKey), privateKey: keyRecord(pair.privateKey) };
      }
      if (parameters.family === "EC") {
        const pair = generateKeyPairSync("ec", { namedCurve: nativeCurveName(parameters.namedCurve) });
        return { publicKey: keyRecord(pair.publicKey), privateKey: keyRecord(pair.privateKey) };
      }
      if (parameters.family !== "RSA") return { failure: "operation" };
      let publicExponent = 0;
      for (let index = 0; index < byteLength(parameters.publicExponent); index++) {
        publicExponent = publicExponent * 256 + parameters.publicExponent[index]!;
        // Node's generateKeyPairSync accepts an unsigned 32-bit exponent only.
        // The shared Web API imposes no corresponding restriction.
        if (publicExponent > 0xffffffff) return { failure: "operation" };
      }
      const pair = generateKeyPairSync("rsa", { modulusLength: parameters.modulusLength, publicExponent });
      return { publicKey: keyRecord(pair.publicKey), privateKey: keyRecord(pair.privateKey) };
    } catch {
      return { failure: "operation" };
    }
  }

  encrypt(
    parameters: CryptoCipherParameters,
    key: CryptoKeyHandle,
    data: Uint8Array,
  ): CryptoCiphertext | CryptoFailure {
    try {
      const nativeKey = keyObjects.get(key);
      if (nativeKey === undefined) return { failure: "invalid-key" };
      if (parameters.name === "RSA-OAEP") {
        return {
          bytes: owned(publicEncrypt({
            key: nativeKey,
            padding: rsaOaepPadding,
            oaepHash: hashName(parameters.hash),
            oaepLabel: parameters.label,
          }, data)),
          tag: null,
        };
      }
      if (parameters.name === "AES-CTR") {
        return { bytes: ctr(parameters, nativeKey, data), tag: null };
      }
      if (parameters.name === "AES-GCM") {
        const name = `aes-${secretBits(nativeKey)}-gcm` as CipherGCMTypes;
        const cipher = createCipheriv(name, nativeKey, parameters.iv, {
          authTagLength: parameters.tagLength / 8,
        });
        cipher.setAAD(parameters.additionalData);
        const bytes = owned(Buffer.concat([cipher.update(data), cipher.final()]));
        return { bytes, tag: owned(cipher.getAuthTag()) };
      }
      if (parameters.name === "AES-CBC" || parameters.name === "AES-KW") {
        const name = parameters.name === "AES-CBC"
          ? `aes-${secretBits(nativeKey)}-cbc`
          : `id-aes${secretBits(nativeKey)}-wrap`;
        const iv = parameters.name === "AES-CBC" ? parameters.iv : keyWrapIv;
        const cipher = createCipheriv(name, nativeKey, iv);
        cipher.setAutoPadding(false);
        return { bytes: owned(Buffer.concat([cipher.update(data), cipher.final()])), tag: null };
      }
      return { failure: "operation" };
    } catch {
      return { failure: "operation" };
    }
  }

  decrypt(
    parameters: CryptoCipherParameters,
    key: CryptoKeyHandle,
    data: CryptoCiphertext,
  ): Uint8Array | CryptoFailure {
    try {
      const nativeKey = keyObjects.get(key);
      if (nativeKey === undefined) return { failure: "invalid-key" };
      if (parameters.name === "RSA-OAEP") {
        return owned(privateDecrypt({
          key: nativeKey,
          padding: rsaOaepPadding,
          oaepHash: hashName(parameters.hash),
          oaepLabel: parameters.label,
        }, data.bytes));
      }
      if (parameters.name === "AES-CTR") return ctr(parameters, nativeKey, data.bytes);
      if (parameters.name === "AES-GCM") {
        if (data.tag === null) return { failure: "operation" };
        const name = `aes-${secretBits(nativeKey)}-gcm` as CipherGCMTypes;
        const cipher = createDecipheriv(name, nativeKey, parameters.iv, {
          authTagLength: parameters.tagLength / 8,
        });
        cipher.setAAD(parameters.additionalData);
        cipher.setAuthTag(data.tag);
        // Keep partial plaintext inside the adapter until final() authenticates it.
        return owned(Buffer.concat([cipher.update(data.bytes), cipher.final()]));
      }
      if (parameters.name === "AES-CBC" || parameters.name === "AES-KW") {
        const name = parameters.name === "AES-CBC"
          ? `aes-${secretBits(nativeKey)}-cbc`
          : `id-aes${secretBits(nativeKey)}-wrap`;
        const iv = parameters.name === "AES-CBC" ? parameters.iv : keyWrapIv;
        const cipher = createDecipheriv(name, nativeKey, iv);
        cipher.setAutoPadding(false);
        return owned(Buffer.concat([cipher.update(data.bytes), cipher.final()]));
      }
      return { failure: "operation" };
    } catch {
      return { failure: "operation" };
    }
  }

  sign(
    parameters: CryptoSignatureParameters,
    key: CryptoKeyHandle,
    data: Uint8Array,
  ): CryptoSignature | CryptoFailure {
    try {
      const nativeKey = keyObjects.get(key);
      if (nativeKey === undefined) return { failure: "invalid-key" };
      if (parameters.name === "HMAC") {
        const bytes = createHmac(hashName(parameters.hash), nativeKey).update(data).digest();
        return { kind: "bytes", bytes: owned(bytes) };
      }
      if (parameters.name === "Ed25519" || parameters.name === "Ed448") {
        if (okpCurveName(nativeKey) !== parameters.name || nativeKey.type !== "private") return { failure: "invalid-key" };
        const options = parameters.name === "Ed448" ? { key: nativeKey, context: parameters.context } : nativeKey;
        return { kind: "bytes", bytes: owned(sign(null, data, options)) };
      }
      if (parameters.name === "ECDSA") {
        if (nativeKey.asymmetricKeyType !== "ec" || nativeKey.type !== "private") return { failure: "invalid-key" };
        const signature = sign(hashName(parameters.hash), data, { key: nativeKey, dsaEncoding: "ieee-p1363" });
        const width = signature.byteLength / 2;
        return { kind: "ecdsa", r: minimalInteger(signature.subarray(0, width)), s: minimalInteger(signature.subarray(width)) };
      }
      if (parameters.name === "RSASSA-PKCS1-v1_5" || parameters.name === "RSA-PSS") {
        const options = parameters.name === "RSA-PSS"
          ? { key: nativeKey, padding: rsaPssPadding, saltLength: parameters.saltLength }
          : { key: nativeKey, padding: rsaPkcs1Padding };
        return { kind: "bytes", bytes: owned(sign(hashName(parameters.hash), data, options)) };
      }
      return { failure: "operation" };
    } catch {
      return { failure: "operation" };
    }
  }

  verify(
    parameters: CryptoSignatureParameters,
    key: CryptoKeyHandle,
    signature: CryptoSignature,
    data: Uint8Array,
  ): boolean {
    try {
      const nativeKey = keyObjects.get(key);
      if (nativeKey === undefined) return false;
      if (parameters.name === "ECDSA") {
        if (signature.kind !== "ecdsa" || nativeKey.asymmetricKeyType !== "ec" || nativeKey.type !== "public") return false;
        const width = byteLength(ecComponents(nativeKey).x);
        if (byteLength(signature.r) !== width || byteLength(signature.s) !== width) return false;
        return verify(hashName(parameters.hash), data, { key: nativeKey, dsaEncoding: "ieee-p1363" },
          Buffer.concat([signature.r, signature.s]));
      }
      if (signature.kind !== "bytes") return false;
      if (parameters.name === "Ed25519" || parameters.name === "Ed448") {
        if (okpCurveName(nativeKey) !== parameters.name || nativeKey.type !== "public") return false;
        const options = parameters.name === "Ed448" ? { key: nativeKey, context: parameters.context } : nativeKey;
        return verify(null, data, options, signature.bytes);
      }
      if (parameters.name === "HMAC") {
        const expected = createHmac(hashName(parameters.hash), nativeKey).update(data).digest();
        return expected.byteLength === byteLength(signature.bytes)
          && timingSafeEqual(expected, signature.bytes);
      }
      if (parameters.name === "RSASSA-PKCS1-v1_5" || parameters.name === "RSA-PSS") {
        const options = parameters.name === "RSA-PSS"
          ? { key: nativeKey, padding: rsaPssPadding, saltLength: parameters.saltLength }
          : { key: nativeKey, padding: rsaPkcs1Padding };
        return verify(hashName(parameters.hash), data, options, signature.bytes);
      }
      return false;
    } catch {
      return false;
    }
  }

  derive(parameters: CryptoDerivationParameters, key: CryptoKeyHandle): Uint8Array | CryptoFailure {
    try {
      if (parameters.name === "HKDF" || parameters.name === "PBKDF2") {
        const secretKey = keyObjects.get(key);
        if (secretKey === undefined || secretKey.type !== "secret") return { failure: "invalid-key" };
        if (parameters.name === "HKDF") {
          // Node 24.20 limits info to 1024 octets, unlike Web Crypto. Its native
          // primitive also rejects zero output: request one byte for native
          // validation, then return the requested empty, independently owned value.
          // Positive outputs already have a fresh, exactly sized ArrayBuffer.
          const result = hkdfSync(hashName(parameters.hash), secretKey,
            parameters.salt, parameters.info, parameters.byteLength === 0 ? 1 : parameters.byteLength);
          return parameters.byteLength === 0 ? new ByteArray(0) : new ByteArray(result);
        }
        // Export bytes directly to the native primitive: PBKDF2 passwords are
        // octet strings, including embedded NUL and non-UTF-8 input.
        // Node 24.20 limits iterations to 2^31-1; the shared unsigned-long
        // range remains 2^32-1. Shared PBKDF2 handles zero output before this call.
        return owned(pbkdf2Sync(secretKey.export(), parameters.salt,
          parameters.iterations, parameters.byteLength, hashName(parameters.hash)));
      }
      if (parameters.name !== "ECDH" && parameters.name !== "X25519" && parameters.name !== "X448") return { failure: "operation" };
      const privateKey = keyObjects.get(key);
      const publicKey = keyObjects.get(parameters.publicKey);
      const nativeType = parameters.name === "ECDH" ? "ec" : parameters.name === "X25519" ? "x25519" : "x448";
      if (privateKey === undefined || publicKey === undefined
        || privateKey.type !== "private" || publicKey.type !== "public"
        || privateKey.asymmetricKeyType !== nativeType || publicKey.asymmetricKeyType !== nativeType) {
        return { failure: "invalid-key" };
      }
      return owned(diffieHellman({ privateKey, publicKey }));
    } catch {
      return { failure: "operation" };
    }
  }
}
