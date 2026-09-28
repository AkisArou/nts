// Web Crypto's `digest`, from node v24.20.0 `lib/internal/crypto/hash.js`
// (`asyncDigest`): node's `HashJob` on the thread pool, here `crypto.c`'s
// digest job.

import { digestId } from "../util.ts";
import {
  bytesJob,
  bytesOfSource,
  type Job,
  jobPromise,
  type NormalizedAlgorithm,
  validateMaxBufferLength,
  webCryptoHashName,
} from "./util.ts";

/** The digest a normalized algorithm names, by `crypto.c`'s id. */
export function webCryptoDigestId(algorithm: NormalizedAlgorithm): number {
  return digestId(webCryptoHashName(algorithm.name)!);
}

export function asyncDigest(algorithm: NormalizedAlgorithm, data: ArrayBuffer | ArrayBufferView): Job<ArrayBuffer> {
  validateMaxBufferLength(data, "data");
  const id = webCryptoDigestId(algorithm);
  const input = bytesOfSource(data);
  return jobPromise(() =>
    bytesJob("Deriving bits failed", (done) => nts_crypto_digest_job(id, input, -1, done)),
  );
}
