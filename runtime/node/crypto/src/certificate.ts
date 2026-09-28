// `Certificate`: SPKAC, the Netscape signed public key and challenge, from node
// v24.20.0 `lib/internal/crypto/certificate.js` over
// `src/crypto/crypto_spkac.cc` (here `spkac.c`).
//
// Node keeps the old calling convention -- `new Certificate()` and methods on
// it -- beside the static functions that replaced it, and so does this.

import type { Buffer } from "../../buffer/src/main.ts";
import { ERR_OUT_OF_RANGE_BINDING } from "../../internal/errors.ts";
import { asBuffer, bytesOf, getArrayBufferOrView } from "./util.ts";

/**
 * The SPKAC's bytes as node's C++ takes them: null for none, which every
 * function answers with `""` before looking further, and a refusal past an
 * `int`'s reach.
 */
function spkacInput(spkac: unknown, encoding: unknown): Uint8Array | null {
  const bytes = bytesOf(getArrayBufferOrView(spkac, "spkac", typeof encoding === "string" ? encoding : undefined));
  if (bytes.byteLength === 0) return null;
  if (bytes.byteLength > 2 ** 31 - 1) throw new ERR_OUT_OF_RANGE_BINDING("spkac is too large");
  return bytes;
}

/** `Certificate.verifySpkac`: whether the signature checks -- or `""` for no input at all, as node answers. */
function verifySpkac(spkac: unknown, encoding?: unknown): boolean | string {
  const bytes = spkacInput(spkac, encoding);
  return bytes === null ? "" : nts_crypto_spkac_verify(bytes);
}

/** `Certificate.exportPublicKey`: the key as PEM in a `Buffer`, or `""`. */
function exportPublicKey(spkac: unknown, encoding?: unknown): Buffer | string {
  const bytes = spkacInput(spkac, encoding);
  if (bytes === null) return "";
  const key = nts_crypto_spkac_public_key(bytes);
  return key === null ? "" : asBuffer(key);
}

/** `Certificate.exportChallenge`: the challenge in a `Buffer`, or `""`. */
function exportChallenge(spkac: unknown, encoding?: unknown): Buffer | string {
  const bytes = spkacInput(spkac, encoding);
  if (bytes === null) return "";
  const challenge = nts_crypto_spkac_challenge(bytes);
  return challenge === null ? "" : asBuffer(challenge);
}

export class Certificate {
  static verifySpkac(spkac: unknown, encoding?: unknown): boolean | string {
    return verifySpkac(spkac, encoding);
  }

  static exportPublicKey(spkac: unknown, encoding?: unknown): Buffer | string {
    return exportPublicKey(spkac, encoding);
  }

  static exportChallenge(spkac: unknown, encoding?: unknown): Buffer | string {
    return exportChallenge(spkac, encoding);
  }

  verifySpkac(spkac: unknown, encoding?: unknown): boolean | string {
    return verifySpkac(spkac, encoding);
  }

  exportPublicKey(spkac: unknown, encoding?: unknown): Buffer | string {
    return exportPublicKey(spkac, encoding);
  }

  exportChallenge(spkac: unknown, encoding?: unknown): Buffer | string {
    return exportChallenge(spkac, encoding);
  }
}
