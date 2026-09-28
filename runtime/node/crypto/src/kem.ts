// Key encapsulation: `encapsulate` and `decapsulate`, from node v24.20.0
// `lib/internal/crypto/kem.js` over `src/crypto/crypto_kem.cc` (here `kem.c`).
//
// A synchronous failure is node's own words, thrown from C++ while the job
// runs; an asynchronous one is the job's error, which has nothing from OpenSSL
// to say either, so it is node's generic one.

import type { Buffer } from "../../buffer/src/main.ts";
import { getDefaultTriggerAsyncId } from "../../internal/async-hooks.ts";
import { AsyncRequest } from "../../internal/async-request.ts";
import { ERR_CRYPTO_OPERATION_FAILED } from "../../internal/errors.ts";
import { validateFunction } from "../../internal/validators.ts";
import { preparePrivateKey, preparePublicOrPrivateKey, privateKeyOf, publicOrPrivateKeyOf } from "./keys.ts";
import { asBuffer, bytesOf, getArrayBufferOrView, jobError } from "./util.ts";

/** What node's `DeriveBitsJob` says when OpenSSL queued nothing to say instead. */
const DERIVE_FAILED = "Deriving bits failed";

export interface Encapsulation {
  sharedKey: Buffer;
  ciphertext: Buffer;
}

type EncapsulateCallback = (error: Error | null, result?: Encapsulation) => void;
type DecapsulateCallback = (error: Error | null, sharedKey?: Buffer) => void;

/** `crypto.encapsulate(key[, callback])`: a shared key, and the ciphertext that carries it. */
export function encapsulate(key: unknown, callback?: unknown): Encapsulation | undefined {
  if (callback !== undefined) validateFunction(callback, "callback");
  const native = publicOrPrivateKeyOf(preparePublicOrPrivateKey(key)).native;
  if (callback === undefined) {
    const parts = nts_crypto_kem_encapsulate(native);
    if (parts.length === 0) throw new ERR_CRYPTO_OPERATION_FAILED("Failed to perform encapsulation");
    return { sharedKey: asBuffer(parts[0]!), ciphertext: asBuffer(parts[1]!) };
  }
  queueEncapsulate(native, callback as EncapsulateCallback);
  return undefined;
}

function queueEncapsulate(key: number, done: EncapsulateCallback): void {
  const request = new AsyncRequest("DERIVEBITSREQUEST", getDefaultTriggerAsyncId());
  nts_crypto_kem_encapsulate_job(key, (ok, sharedKey, ciphertext) => {
    const failure = ok ? null : jobError(DERIVE_FAILED);
    request.complete(() => {
      if (failure !== null) done(failure);
      else done(null, { sharedKey: asBuffer(sharedKey), ciphertext: asBuffer(ciphertext) });
    });
  });
}

/** `crypto.decapsulate(key, ciphertext[, callback])`: the shared key the ciphertext carries. */
export function decapsulate(key: unknown, ciphertext: unknown, callback?: unknown): Buffer | undefined {
  if (callback !== undefined) validateFunction(callback, "callback");
  const prepared = preparePrivateKey(key);
  const bytes = bytesOf(getArrayBufferOrView(ciphertext, "ciphertext"));
  const native = privateKeyOf(prepared).native;
  if (callback === undefined) {
    const sharedKey = nts_crypto_kem_decapsulate(native, bytes);
    if (sharedKey === null) throw new ERR_CRYPTO_OPERATION_FAILED("Failed to perform decapsulation");
    return asBuffer(sharedKey);
  }
  queueDecapsulate(native, bytes, callback as DecapsulateCallback);
  return undefined;
}

function queueDecapsulate(key: number, ciphertext: Uint8Array, done: DecapsulateCallback): void {
  const request = new AsyncRequest("DERIVEBITSREQUEST", getDefaultTriggerAsyncId());
  nts_crypto_kem_decapsulate_job(key, ciphertext, (ok, sharedKey) => {
    const failure = ok ? null : jobError(DERIVE_FAILED);
    request.complete(() => {
      if (failure !== null) done(failure);
      else done(null, asBuffer(sharedKey));
    });
  });
}
