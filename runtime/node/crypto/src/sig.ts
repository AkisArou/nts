// Signatures: `Sign`, `Verify`, `crypto.sign` and `crypto.verify`, from node
// v24.20.0 `lib/internal/crypto/sig.js`, over `src/crypto/crypto_sig.cc`.
//
// # Two halves, one order
//
// Node checks a call's arguments in JavaScript and then its key, digest and
// signature in C++. Both halves are here, in node's order: `preparePrivateKey`
// is the JavaScript's look at the key, `privateKeyOf` the C++'s parse of it,
// and the options between them are validated between them. So the same
// mistake gets the same error whichever form a program called.
//
// # Two signature encodings
//
// A DSA or ECDSA signature is DER by default and `r || s` under
// `dsaEncoding: 'ieee-p1363'`. The streams and the one-shot functions convert
// at different moments and fail differently, and the difference is node's: a
// malformed P1363 signature throws from `Verify#verify` and is merely false
// from `crypto.verify`.

import { Buffer } from "../../buffer/src/main.ts";
import { getDefaultTriggerAsyncId } from "../../internal/async-hooks.ts";
import { AsyncRequest } from "../../internal/async-request.ts";
import {
  ERR_CRYPTO_INVALID_DIGEST,
  ERR_CRYPTO_INVALID_STATE_BINDING,
  ERR_CRYPTO_OPERATION_FAILED,
  ERR_CRYPTO_SIGN_KEY_REQUIRED,
  ERR_CRYPTO_UNSUPPORTED_OPERATION,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_OUT_OF_RANGE_BINDING,
} from "../../internal/errors.ts";
import { validateFunction, validateString } from "../../internal/validators.ts";
import { Writable } from "../../stream/src/main.ts";
import type { WritableOptions } from "../../stream/src/writable.ts";
import type { WriteCallback } from "../../stream/src/writable.ts";
import { isArrayBufferView } from "../../util/src/types.ts";
import { constants } from "./constants.ts";
import { checkUpdate, feed } from "./hash.ts";
import { preparePrivateKey, preparePublicOrPrivateKey, privateKeyOf, publicOrPrivateKeyOf } from "./keys.ts";
import { asBuffer, bytesOf, digestId, getArrayBufferOrView, jobError, queuedCryptoError } from "./util.ts";

/** `kSigEncDER` and `kSigEncP1363`. */
const SigEncoding = { DER: 0, P1363: 1 } as const;

/** `sig.c`'s statuses for a one-shot signature that failed. */
const SignStatus = { Init: -1, PrivateKey: -2, ContextUnsupported: -3 } as const;

/** `sig.c`'s answers from `Verify#verify`. */
const VerifyResult = { True: 1, PublicKey: -1 } as const;

/** What node's `DeriveBitsJob` says when OpenSSL queued nothing to say instead. */
const DERIVE_FAILED = "Deriving bits failed";

const noBytes = new Uint8Array(0);

/**
 * The options a key argument may carry beside the key. Node reads them off
 * whatever the argument is; a string's or a buffer's are simply absent.
 */
interface SignKeyOptions {
  padding?: unknown;
  saltLength?: unknown;
  dsaEncoding?: unknown;
  context?: unknown;
}

const noOptions: SignKeyOptions = {};

function optionsOf(key: unknown): SignKeyOptions {
  if (typeof key === "object" || key === undefined) return key as SignKeyOptions;
  return noOptions;
}

/** Node's `getIntOption`, given the option's value: an int32, or absent. */
function getIntOption(name: string, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && value === value >> 0) return value;
  throw new ERR_INVALID_ARG_VALUE(`options.${name}`, value);
}

function getPadding(options: SignKeyOptions): number | undefined {
  return getIntOption("padding", options.padding);
}

/** PSS without a salt length is the longest salt the key allows, as node chooses. */
function getSaltLength(options: SignKeyOptions): number | undefined {
  const saltLength = getIntOption("saltLength", options.saltLength);
  if (options.padding === constants.RSA_PKCS1_PSS_PADDING && saltLength === undefined) {
    return constants.RSA_PSS_SALTLEN_MAX_SIGN;
  }
  return saltLength;
}

function getDSASignatureEncoding(key: unknown): number {
  if (typeof key !== "object") return SigEncoding.DER;
  // A destructuring default: `undefined` is DER, and `null` is refused.
  const given = (key as SignKeyOptions).dsaEncoding;
  const dsaEncoding = given === undefined ? "der" : given;
  if (dsaEncoding === "der") return SigEncoding.DER;
  if (dsaEncoding === "ieee-p1363") return SigEncoding.P1363;
  throw new ERR_INVALID_ARG_VALUE("options.dsaEncoding", dsaEncoding);
}

/** Ed448's and ML-DSA's context string. */
function getContext(options: SignKeyOptions): ArrayBufferView | undefined {
  const context = options?.context;
  if (context === undefined) return undefined;
  if (!isArrayBufferView(context)) {
    throw new ERR_INVALID_ARG_TYPE("options.context", ["Buffer", "TypedArray", "DataView"], context);
  }
  return context;
}

/** An option absent at the ABI. */
function orNaN(value: number | undefined): number {
  return value === undefined ? NaN : value;
}

/**
 * Node's `CheckThrow` for a failure OpenSSL may have explained: its error if
 * it queued one, and node's words for the step otherwise.
 */
function checkThrow(step: string): Error {
  return queuedCryptoError() ?? new ERR_CRYPTO_OPERATION_FAILED(step);
}

/** `SignBase::Init`: a hash context for the stream's digest. */
function signInit(algorithm: string): number {
  const id = digestId(algorithm);
  if (id < 0) throw new ERR_CRYPTO_INVALID_DIGEST();
  const handle = nts_crypto_sign_init(id);
  if (handle === 0) throw checkThrow("EVP_SignInit_ex failed");
  return handle;
}

/** `SignBase::Update`, which a finished stream refuses. */
function signUpdate(handle: number, data: unknown, encoding: unknown, step: string): void {
  checkUpdate(data, encoding);
  if (handle === 0) throw new ERR_CRYPTO_INVALID_STATE_BINDING("Not initialised");
  if (!feed(handle, data, encoding)) throw checkThrow(step);
}

/** A key that signs the message itself cannot finish a stream of it. */
function refuseOneShotKey(key: number): void {
  if (nts_crypto_key_is_one_shot(key)) throw new ERR_CRYPTO_UNSUPPORTED_OPERATION("Unsupported crypto operation");
}

/** A DER signature as `r || s`, or null when it is not two integers the key's width. */
function toP1363(key: number, der: Uint8Array): Uint8Array | null {
  const size = nts_crypto_key_dsa_size(key);
  return size === 0 ? der : nts_crypto_signature_to_p1363(size, der);
}

/** `r || s` as DER, or null when it is not two integers' width. */
function toDer(key: number, p1363: Uint8Array): Uint8Array | null {
  const size = nts_crypto_key_dsa_size(key);
  return size === 0 ? p1363 : nts_crypto_signature_to_der(size, p1363);
}

export class Sign extends Writable {
  #handle: number;

  constructor(algorithm: unknown, options?: WritableOptions) {
    super(options);
    validateString(algorithm, "algorithm");
    this.#handle = signInit(algorithm);
  }

  override _write(chunk: unknown, encoding: string | undefined, callback: WriteCallback): void {
    this.update(chunk as string | ArrayBufferView, encoding);
    callback();
  }

  update(data: string | ArrayBufferView, encoding?: string): this {
    signUpdate(this.#handle, data, encoding, "EVP_SignUpdate failed");
    return this;
  }

  sign(privateKey: unknown): Buffer;
  sign(privateKey: unknown, outputEncoding: string): string | Buffer;
  sign(privateKey: unknown, outputEncoding?: string): string | Buffer {
    if (!privateKey) throw new ERR_CRYPTO_SIGN_KEY_REQUIRED();
    const prepared = preparePrivateKey(privateKey, "privateKey");
    const options = optionsOf(privateKey);
    const padding = getPadding(options);
    const saltLength = getSaltLength(options);
    const dsaEncoding = getDSASignatureEncoding(privateKey);

    const key = privateKeyOf(prepared).native;
    refuseOneShotKey(key);
    if (this.#handle === 0) throw new ERR_CRYPTO_INVALID_STATE_BINDING("Not initialised");
    const handle = this.#handle;
    this.#handle = 0;
    let signature = nts_crypto_sign_final(handle, key, orNaN(padding), orNaN(saltLength));
    if (signature === null) throw checkThrow("PEM_read_bio_PrivateKey failed");
    // A signature that will not convert is returned as DER, as node returns it.
    if (dsaEncoding === SigEncoding.P1363) signature = toP1363(key, signature) ?? signature;

    const buffer = asBuffer(signature);
    if (outputEncoding && outputEncoding !== "buffer") return buffer.toString(outputEncoding);
    return buffer;
  }
}

export class Verify extends Writable {
  #handle: number;

  constructor(algorithm: unknown, options?: WritableOptions) {
    super(options);
    validateString(algorithm, "algorithm");
    this.#handle = signInit(algorithm);
  }

  override _write(chunk: unknown, encoding: string | undefined, callback: WriteCallback): void {
    this.update(chunk as string | ArrayBufferView, encoding);
    callback();
  }

  update(data: string | ArrayBufferView, encoding?: string): this {
    signUpdate(this.#handle, data, encoding, "EVP_SignUpdate failed");
    return this;
  }

  verify(key: unknown, signature: unknown, signatureEncoding?: string): boolean {
    const prepared = preparePublicOrPrivateKey(key, "key");
    const options = optionsOf(key);
    const padding = getPadding(options);
    const saltLength = getSaltLength(options);
    const dsaEncoding = getDSASignatureEncoding(key);
    const given = bytesOf(getArrayBufferOrView(signature, "signature", signatureEncoding));

    const native = publicOrPrivateKeyOf(prepared).native;
    refuseOneShotKey(native);
    let der: Uint8Array | null = given;
    if (dsaEncoding === SigEncoding.P1363) {
      der = toDer(native, given);
      if (der === null) throw new ERR_CRYPTO_OPERATION_FAILED("Malformed signature");
    }
    if (this.#handle === 0) throw new ERR_CRYPTO_INVALID_STATE_BINDING("Not initialised");
    const handle = this.#handle;
    this.#handle = 0;
    const result = nts_crypto_verify_final(handle, native, der, orNaN(padding), orNaN(saltLength));
    if (result === VerifyResult.PublicKey) throw checkThrow("PEM_read_bio_PUBKEY failed");
    return result === VerifyResult.True;
  }
}

export function createSign(algorithm: unknown, options?: WritableOptions): Sign {
  return new Sign(algorithm, options);
}

export function createVerify(algorithm: unknown, options?: WritableOptions): Verify {
  return new Verify(algorithm, options);
}

// -- the one-shot functions: node's SignJob ----------------------------------

/** A `SignJob`'s configuration, as `SignTraits::AdditionalConfig` checks it. */
interface SignJobConfig {
  key: number;
  data: Uint8Array;
  digest: number;
  saltLength: number;
  padding: number;
  dsaEncoding: number;
  context: Uint8Array;
}

function signJobConfig(
  key: number,
  data: Uint8Array,
  algorithm: unknown,
  saltLength: number | undefined,
  padding: number | undefined,
  dsaEncoding: number,
  context: ArrayBufferView | undefined,
): SignJobConfig {
  let digest = -1;
  if (typeof algorithm === "string") {
    digest = digestId(algorithm);
    if (digest < 0) throw new ERR_CRYPTO_INVALID_DIGEST(algorithm);
  }
  const contextBytes = context === undefined ? noBytes : bytesOf(context);
  if (contextBytes.byteLength > 255) {
    throw new ERR_OUT_OF_RANGE_BINDING("context string must be at most 255 bytes");
  }
  return {
    key,
    data,
    digest,
    saltLength: orNaN(saltLength),
    padding: orNaN(padding),
    dsaEncoding,
    context: contextBytes,
  };
}

/** A synchronous `SignJob`'s failure, thrown as node's `CheckThrow` throws it. */
function signJobError(): Error {
  const status = nts_crypto_sign_status();
  if (status === SignStatus.ContextUnsupported) {
    return new ERR_CRYPTO_OPERATION_FAILED("Context parameter is unsupported");
  }
  return checkThrow(status === SignStatus.Init ? "EVP_SignInit_ex failed" : "PEM_read_bio_PrivateKey failed");
}

/**
 * A job's completion as node's `CryptoJob` delivers it: once, in the
 * request's scope, with the job's own error when it failed.
 */
function signJobDone<T>(
  read: (bytes: Uint8Array) => T,
  callback: (error: Error | null, result?: T) => void,
): (ok: boolean, bytes: Uint8Array) => void {
  const request = new AsyncRequest("SIGNREQUEST", getDefaultTriggerAsyncId());
  return (ok, bytes) => {
    const error = ok ? null : jobError(DERIVE_FAILED);
    request.complete(() => {
      if (error !== null) callback(error);
      else callback(null, read(bytes));
    });
  };
}

/** A one-shot signature as the program gets it: `r || s` if it asked, and a `Buffer`. */
function signatureOf(config: SignJobConfig, signature: Uint8Array): Buffer {
  // `UseP1363Encoding`; a signature that will not convert is empty, as node's is.
  if (config.dsaEncoding === SigEncoding.P1363) return asBuffer(toP1363(config.key, signature) ?? noBytes);
  return asBuffer(signature);
}

type SignCallback = (error: Error | null, signature?: Buffer) => void;
type VerifyCallback = (error: Error | null, result?: boolean) => void;

/** `crypto.sign(algorithm, data, key[, callback])`. */
export function sign(algorithm: unknown, data: unknown, key: unknown): Buffer;
export function sign(algorithm: unknown, data: unknown, key: unknown, callback: SignCallback): void;
export function sign(algorithm: unknown, data: unknown, key: unknown, callback?: unknown): Buffer | undefined {
  if (algorithm !== null && algorithm !== undefined) validateString(algorithm, "algorithm");
  if (callback !== undefined) validateFunction(callback, "callback");
  const bytes = bytesOf(getArrayBufferOrView(data, "data"));
  if (!key) throw new ERR_CRYPTO_SIGN_KEY_REQUIRED();
  const options = optionsOf(key);
  const padding = getPadding(options);
  const saltLength = getSaltLength(options);
  const dsaEncoding = getDSASignatureEncoding(key);
  const context = getContext(options);
  const prepared = preparePrivateKey(key);

  const native = privateKeyOf(prepared).native;
  const config = signJobConfig(native, bytes, algorithm, saltLength, padding, dsaEncoding, context);
  if (callback === undefined) {
    const signature = nts_crypto_sign_job_sync(
      false,
      config.key,
      config.data,
      config.digest,
      config.saltLength,
      config.padding,
      config.context,
      noBytes,
    );
    if (signature === null) throw signJobError();
    return signatureOf(config, signature);
  }
  const done = signJobDone((signature) => signatureOf(config, signature), callback as SignCallback);
  nts_crypto_sign_job(
    false,
    config.key,
    config.data,
    config.digest,
    config.saltLength,
    config.padding,
    config.context,
    noBytes,
    done,
  );
  return undefined;
}

/** `crypto.verify(algorithm, data, key, signature[, callback])`. */
export function verify(algorithm: unknown, data: unknown, key: unknown, signature: unknown): boolean;
export function verify(
  algorithm: unknown,
  data: unknown,
  key: unknown,
  signature: unknown,
  callback: VerifyCallback,
): void;
export function verify(
  algorithm: unknown,
  data: unknown,
  key: unknown,
  signature: unknown,
  callback?: unknown,
): boolean | undefined {
  if (algorithm !== null && algorithm !== undefined) validateString(algorithm, "algorithm");
  if (callback !== undefined) validateFunction(callback, "callback");
  const bytes = bytesOf(getArrayBufferOrView(data, "data"));
  const options = optionsOf(key);
  const padding = getPadding(options);
  const saltLength = getSaltLength(options);
  const dsaEncoding = getDSASignatureEncoding(key);
  const context = getContext(options);
  const given = bytesOf(getArrayBufferOrView(signature, "signature"));
  const prepared = preparePublicOrPrivateKey(key);

  const native = publicOrPrivateKeyOf(prepared).native;
  const config = signJobConfig(native, bytes, algorithm, saltLength, padding, dsaEncoding, context);
  // A P1363 signature that will not convert verifies nothing, rather than throwing.
  const der = dsaEncoding === SigEncoding.P1363 ? (toDer(native, given) ?? noBytes) : given;
  if (callback === undefined) {
    const answer = nts_crypto_sign_job_sync(
      true,
      config.key,
      config.data,
      config.digest,
      config.saltLength,
      config.padding,
      config.context,
      der,
    );
    if (answer === null) throw signJobError();
    return answer[0] === 1;
  }
  const done = signJobDone((answer) => answer[0] === 1, callback as VerifyCallback);
  nts_crypto_sign_job(
    true,
    config.key,
    config.data,
    config.digest,
    config.saltLength,
    config.padding,
    config.context,
    der,
    done,
  );
  return undefined;
}
