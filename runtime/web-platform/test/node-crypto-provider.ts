import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createSecretKey,
  timingSafeEqual,
} from "node:crypto";
import type { CipherGCMTypes, KeyObject } from "node:crypto";
import type {
  CryptoAesCtrParameters,
  CryptoCipherParameters,
  CryptoCiphertext,
  CryptoDerivationParameters,
  CryptoDigestName,
  CryptoFailure,
  CryptoKeyComponents,
  CryptoKeyHandle,
  CryptoKeyImport,
  CryptoKeyPairGeneration,
  CryptoKeyPairRecord,
  CryptoKeyRecord,
  CryptoProvider,
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

/** Test-only native primitives. No Web Crypto implementation is called here. */
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
      let bytes: Uint8Array;
      if (input.format === "raw" && input.family === "secret") {
        bytes = input.bytes;
      } else if (input.format === "components" && input.components.family === "secret") {
        bytes = input.components.k;
      } else {
        // Asymmetric encodings arrive with their separate implementation PRs.
        return { failure: "operation" };
      }
      const key = createSecretKey(bytes);
      const handle = {} as CryptoKeyHandle;
      keyObjects.set(handle, key);
      return {
        handle,
        info: { family: "secret", type: "secret", length: secretBits(key) },
      };
    } catch {
      return { failure: "invalid-key" };
    }
  }

  exportKey(key: CryptoKeyHandle, format: "raw" | "spki" | "pkcs8"): Uint8Array | CryptoFailure {
    try {
      const nativeKey = keyObjects.get(key);
      if (nativeKey === undefined) return { failure: "invalid-key" };
      if (format !== "raw") return { failure: "operation" };
      return owned(nativeKey.export());
    } catch {
      return { failure: "operation" };
    }
  }

  exportComponents(key: CryptoKeyHandle): CryptoKeyComponents | CryptoFailure {
    try {
      const nativeKey = keyObjects.get(key);
      if (nativeKey === undefined) return { failure: "invalid-key" };
      return { family: "secret", k: owned(nativeKey.export()) };
    } catch {
      return { failure: "operation" };
    }
  }

  generateKeyPair(_parameters: CryptoKeyPairGeneration): CryptoKeyPairRecord | CryptoFailure {
    return { failure: "operation" };
  }

  encrypt(
    parameters: CryptoCipherParameters,
    key: CryptoKeyHandle,
    data: Uint8Array,
  ): CryptoCiphertext | CryptoFailure {
    try {
      const nativeKey = keyObjects.get(key);
      if (nativeKey === undefined) return { failure: "invalid-key" };
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
      if (parameters.name !== "HMAC") return { failure: "operation" };
      const bytes = createHmac(hashName(parameters.hash), nativeKey).update(data).digest();
      return { kind: "bytes", bytes: owned(bytes) };
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
      if (nativeKey === undefined || parameters.name !== "HMAC" || signature.kind !== "bytes") {
        return false;
      }
      const expected = createHmac(hashName(parameters.hash), nativeKey).update(data).digest();
      return expected.byteLength === byteLength(signature.bytes)
        && timingSafeEqual(expected, signature.bytes);
    } catch {
      return false;
    }
  }

  derive(_parameters: CryptoDerivationParameters, _key: CryptoKeyHandle): Uint8Array | CryptoFailure {
    return { failure: "operation" };
  }
}
