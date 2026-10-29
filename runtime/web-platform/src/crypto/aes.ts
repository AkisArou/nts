import { DOMException } from "../core/errors.ts";
import type {
  CryptoAesCbcParameters,
  CryptoAesCtrParameters,
  CryptoAesGcmParameters,
  CryptoCiphertext,
  CryptoFailure,
  CryptoProvider,
} from "../provider/crypto.ts";
import type { AesCbcParams, AesCtrParams, AesGcmParams, Algorithm } from "./algorithms.ts";
import { copyCryptoBytes, cryptoByteSubarray, cryptoViewByteLength } from "./buffer-source.ts";
import type { CryptoKeySlots } from "./crypto-key.ts";

const emptyBytes = new Uint8Array(0);
const maximumGcmPlaintextBytes = 2 ** 39 - 256;
const unsignedLongLongLimit = 2 ** 64;

function operationError(): DOMException {
  return new DOMException("The AES operation failed", "OperationError");
}

function cipherBytes(result: CryptoCiphertext | CryptoFailure): Uint8Array {
  if ("failure" in result) throw operationError();
  return result.bytes;
}

function plaintextBytes(result: Uint8Array | CryptoFailure): Uint8Array {
  if ("failure" in result) throw operationError();
  return result;
}

/** §27.7 and SP 800-38A Appendix B: one message cannot reuse a counter block. */
function ctrParameters(algorithm: AesCtrParams, byteLength: number): CryptoAesCtrParameters {
  if (cryptoViewByteLength(algorithm.counter) !== 16) throw operationError();
  if (algorithm.length === 0 || algorithm.length > 128) throw operationError();
  const partialBlock = byteLength % 16;
  const blocks = (byteLength - partialBlock) / 16 + (partialBlock === 0 ? 0 : 1);
  if (blocks > 2 ** algorithm.length) throw operationError();
  return { name: "AES-CTR", counter: algorithm.counter, counterLength: algorithm.length };
}

function cbcParameters(algorithm: AesCbcParams): CryptoAesCbcParameters {
  if (cryptoViewByteLength(algorithm.iv) !== 16) throw operationError();
  return { name: "AES-CBC", iv: algorithm.iv };
}

function gcmTagLength(algorithm: AesGcmParams): number {
  const length = algorithm.tagLength;
  if (length === undefined) return 128;
  switch (length) {
    case 32:
    case 64:
    case 96:
    case 104:
    case 112:
    case 120:
    case 128:
      return length;
    default:
      throw operationError();
  }
}

function checkGcmLengths(algorithm: AesGcmParams): void {
  // >= 2^64 is the exact representable comparison for > 2^64 - 1.
  if (cryptoViewByteLength(algorithm.iv) >= unsignedLongLongLimit) throw operationError();
  if (algorithm.additionalData !== undefined
    && cryptoViewByteLength(algorithm.additionalData) >= unsignedLongLongLimit) {
    throw operationError();
  }
}

function gcmParameters(algorithm: AesGcmParams, tagLength: number): CryptoAesGcmParameters {
  return {
    name: "AES-GCM",
    iv: algorithm.iv,
    additionalData: algorithm.additionalData === undefined ? emptyBytes : algorithm.additionalData,
    tagLength,
  };
}

/**
 * Web Cryptography §§27.7.1, 28.4.1, 29.4.1 and 30.3.1.
 * https://w3c.github.io/webcrypto/#aes-ctr-operations
 * Normalization, key access checks and task settlement are the public wrapper's.
 * AES-KW reaches this function only through wrapKey, never encrypt registration.
 */
export function encryptAes(
  provider: CryptoProvider,
  algorithm: AesCtrParams | AesCbcParams | AesGcmParams | Algorithm,
  key: CryptoKeySlots,
  data: Uint8Array,
): Uint8Array {
  const length = cryptoViewByteLength(data);
  switch (algorithm.name) {
    case "AES-CTR": {
      const parameters = ctrParameters(algorithm as AesCtrParams, length);
      return cipherBytes(provider.encrypt(parameters, key.handle, data));
    }
    case "AES-CBC": {
      const parameters = cbcParameters(algorithm as AesCbcParams);
      // RFC 2315 §10.3: even block-aligned/empty messages receive a full block.
      const padding = 16 - length % 16;
      const padded = new Uint8Array(length + padding);
      padded.set(data);
      for (let index = length; index < padded.length; index++) padded[index] = padding;
      return cipherBytes(provider.encrypt(parameters, key.handle, padded));
    }
    case "AES-GCM": {
      const normalized = algorithm as AesGcmParams;
      // Encryption and decryption have deliberately different validation orders.
      checkGcmLengths(normalized);
      const tagLength = gcmTagLength(normalized);
      if (length > maximumGcmPlaintextBytes) throw operationError();
      const result = provider.encrypt(gcmParameters(normalized, tagLength), key.handle, data);
      if ("failure" in result || result.tag === null) throw operationError();
      const ciphertextLength = cryptoViewByteLength(result.bytes);
      const tagBytes = cryptoViewByteLength(result.tag);
      const ciphertext = new Uint8Array(ciphertextLength + tagBytes);
      ciphertext.set(result.bytes);
      ciphertext.set(result.tag, ciphertextLength);
      return ciphertext;
    }
    case "AES-KW": {
      // RFC 3394 §2.2.1 takes n >= 2 complete 64-bit blocks; this is not KWP.
      if (length < 16 || length % 8 !== 0) throw operationError();
      return cipherBytes(provider.encrypt({ name: "AES-KW" }, key.handle, data));
    }
    default:
      throw new DOMException("The algorithm is not an AES operation", "NotSupportedError");
  }
}

/** Web Cryptography §§27.7.2, 28.4.2, 29.4.2 and 30.3.2. */
export function decryptAes(
  provider: CryptoProvider,
  algorithm: AesCtrParams | AesCbcParams | AesGcmParams | Algorithm,
  key: CryptoKeySlots,
  data: Uint8Array,
): Uint8Array {
  const length = cryptoViewByteLength(data);
  switch (algorithm.name) {
    case "AES-CTR": {
      const parameters = ctrParameters(algorithm as AesCtrParams, length);
      return plaintextBytes(provider.decrypt(parameters, key.handle, { bytes: data, tag: null }));
    }
    case "AES-CBC": {
      const parameters = cbcParameters(algorithm as AesCbcParams);
      if (length === 0 || length % 16 !== 0) throw operationError();
      const padded = plaintextBytes(provider.decrypt(parameters, key.handle, { bytes: data, tag: null }));
      const paddedLength = cryptoViewByteLength(padded);
      const padding = padded[paddedLength - 1]!;
      // Inspect the complete final block regardless of the padding value or the
      // first mismatch. Only the final decision depends on the collected result.
      let invalid = ((padding - 1) >>> 31) | ((16 - padding) >>> 31);
      for (let index = 0; index < 16; index++) {
        invalid |= (padded[paddedLength - index - 1]! ^ padding) & ((index - padding) >> 31);
      }
      if (invalid !== 0) throw operationError();
      // Return an exact buffer: exposing a subview's backing buffer would retain
      // the padding in SubtleCrypto's public ArrayBuffer result.
      return copyCryptoBytes(cryptoByteSubarray(padded, 0, paddedLength - padding));
    }
    case "AES-GCM": {
      const normalized = algorithm as AesGcmParams;
      const tagLength = gcmTagLength(normalized);
      checkGcmLengths(normalized);
      const tagBytes = tagLength / 8;
      if (length < tagBytes) throw operationError();
      const ciphertext = {
        bytes: cryptoByteSubarray(data, 0, length - tagBytes),
        tag: cryptoByteSubarray(data, length - tagBytes, length),
      };
      return plaintextBytes(provider.decrypt(gcmParameters(normalized, tagLength), key.handle, ciphertext));
    }
    case "AES-KW": {
      // RFC 3394 §2.2.2 adds one 64-bit integrity block to n >= 2 data blocks.
      if (length < 24 || length % 8 !== 0) throw operationError();
      return plaintextBytes(provider.decrypt({ name: "AES-KW" }, key.handle, { bytes: data, tag: null }));
    }
    default:
      throw new DOMException("The algorithm is not an AES operation", "NotSupportedError");
  }
}
