import { DOMException } from "../core/errors.ts";
import type { CryptoAeadParameters, CryptoProvider } from "../provider/crypto.ts";
import type { AeadParams, NormalizedAlgorithm } from "./algorithms.ts";
import { cryptoByteSubarray, cryptoViewByteLength } from "./buffer-source.ts";
import type { CryptoKeySlots } from "./crypto-key.ts";

const emptyBytes = new Uint8Array(0);

function operationError(): DOMException {
  return new DOMException("The authenticated encryption operation failed", "OperationError");
}

/** Modern Algorithms §§10.4.1–2 and 11.3.1–2: IV validation precedes tag policy. */
function aeadParameters(algorithm: AeadParams): CryptoAeadParameters {
  const ivLength = cryptoViewByteLength(algorithm.iv);
  const ocb = algorithm.name === "AES-OCB";
  if (ocb ? ivLength > 15 : ivLength !== 12) throw operationError();
  const tagLength = algorithm.tagLength ?? 128;
  if (ocb ? tagLength !== 64 && tagLength !== 96 && tagLength !== 128 : tagLength !== 128) {
    throw operationError();
  }
  return { name: algorithm.name, iv: algorithm.iv,
    additionalData: algorithm.additionalData ?? emptyBytes, tagLength };
}

/** https://wicg.github.io/webcrypto-modern-algos/#aes-ocb-operations-encrypt */
export function encryptAead(provider: CryptoProvider, algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots, data: Uint8Array): Uint8Array {
  const parameters = aeadParameters(algorithm as AeadParams);
  const result = provider.encrypt(parameters, key.handle, data);
  if ("failure" in result || result.tag === null
    || cryptoViewByteLength(result.tag) !== parameters.tagLength / 8) throw operationError();
  const byteLength = cryptoViewByteLength(result.bytes);
  const output = new Uint8Array(byteLength + cryptoViewByteLength(result.tag));
  output.set(result.bytes);
  output.set(result.tag, byteLength);
  return output;
}

/** Authentication remains a single native operation, with no partial plaintext. */
export function decryptAead(provider: CryptoProvider, algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots, data: Uint8Array): Uint8Array {
  const parameters = aeadParameters(algorithm as AeadParams);
  const tagBytes = parameters.tagLength / 8;
  const byteLength = cryptoViewByteLength(data);
  if (byteLength < tagBytes) throw operationError();
  const result = provider.decrypt(parameters, key.handle, {
    bytes: cryptoByteSubarray(data, 0, byteLength - tagBytes),
    tag: cryptoByteSubarray(data, byteLength - tagBytes, byteLength),
  });
  if ("failure" in result) throw operationError();
  return result;
}
