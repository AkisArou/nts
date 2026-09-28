// Web Crypto's `digest`, from node v24.20.0 `lib/internal/crypto/hash.js`
// (`asyncDigest`): node's `HashJob` on the thread pool, here `crypto.c`'s
// digest job, and its `CShakeJob`, `TurboShakeJob` and `KangarooTwelveJob`,
// here `keccak.c`'s.

import { digestId } from "../util.ts";
import {
  bytesJob,
  bytesOfSource,
  type Job,
  jobPromise,
  mapJob,
  type NormalizedAlgorithm,
  numBitsToBytes,
  truncateToBitLength,
  validateMaxBufferLength,
  webCryptoHashName,
} from "./util.ts";

/** The digest a normalized algorithm names, by `crypto.c`'s id. */
export function webCryptoDigestId(algorithm: NormalizedAlgorithm): number {
  return digestId(webCryptoHashName(algorithm.name)!);
}

const noBytes = new Uint8Array(0);

/** A variant's strength, from the digits closing its name: `cSHAKE128` is 128. */
function variantOf(name: string): number {
  return name.endsWith("128") ? 128 : 256;
}

export function asyncDigest(algorithm: NormalizedAlgorithm, data: ArrayBuffer | ArrayBufferView): Job<ArrayBuffer> {
  validateMaxBufferLength(data, "data");
  const input = bytesOfSource(data);
  switch (algorithm.name) {
    case "cSHAKE128":
    case "cSHAKE256": {
      const outputLength = algorithm.outputLength!;
      const variant = variantOf(algorithm.name);
      const functionName = algorithm.functionName ?? noBytes;
      const customization = algorithm.customization ?? noBytes;
      if (functionName.byteLength > 0 || customization.byteLength > 0) {
        return jobPromise(() =>
          bytesJob("Deriving bits failed", (done) =>
            nts_crypto_cshake_job(variant, input, functionName, customization, outputLength, done),
          ),
        );
      }
      // With neither, cSHAKE is SHAKE: node's `HashJob`, cut to the bit.
      const id = webCryptoDigestId(algorithm);
      const bits = jobPromise(() =>
        bytesJob("Deriving bits failed", (done) => nts_crypto_digest_job(id, input, numBitsToBytes(outputLength), done)),
      );
      if (outputLength % 8 === 0) return bits;
      return mapJob(bits, (bytes) => truncateToBitLength(outputLength, bytes).buffer as ArrayBuffer);
    }
    case "TurboSHAKE128":
    case "TurboSHAKE256": {
      const variant = variantOf(algorithm.name);
      const domain = algorithm.domainSeparation ?? 0x1f;
      const length = algorithm.outputLength! / 8;
      return jobPromise(() =>
        bytesJob("Deriving bits failed", (done) => nts_crypto_turboshake_job(variant, domain, length, input, done)),
      );
    }
    case "KT128":
    case "KT256": {
      const variant = variantOf(algorithm.name);
      const customization = algorithm.customization ?? noBytes;
      const length = algorithm.outputLength! / 8;
      return jobPromise(() =>
        bytesJob("Deriving bits failed", (done) =>
          nts_crypto_kangaroo_twelve_job(variant, customization, length, input, done),
        ),
      );
    }
    default: {
      const id = webCryptoDigestId(algorithm);
      return jobPromise(() =>
        bytesJob("Deriving bits failed", (done) => nts_crypto_digest_job(id, input, -1, done)),
      );
    }
  }
}
