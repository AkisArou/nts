// Key generation: `generateKeyPair`, `generateKeyPairSync`, `generateKey` and
// `generateKeySync`, from node v24.20.0 `lib/internal/crypto/keygen.js`, over
// `src/crypto/crypto_keygen.cc` and each family's traits (here `keygen.c`).
//
// Node validates a call in JavaScript and configures its job in C++, where a
// bad curve, digest, DH group or cipher is refused before anything is
// generated; then the job runs inline or on the thread pool. Both halves are
// here, in node's order, so a mistake is reported the same way whichever form
// was called. The C++ half's refusals are checked before the job is made, or
// release it: a job is never left behind by a call that threw.

import type { Buffer } from "../../buffer/src/main.ts";
import { getDefaultTriggerAsyncId } from "../../internal/async-hooks.ts";
import { AsyncRequest } from "../../internal/async-request.ts";
import {
  ERR_CRYPTO_INVALID_CURVE,
  ERR_CRYPTO_INVALID_DIGEST_BINDING,
  ERR_CRYPTO_UNKNOWN_DH_GROUP,
  ERR_INCOMPATIBLE_OPTION_PAIR,
  ERR_INVALID_ARG_VALUE,
  ERR_MISSING_OPTION,
} from "../../internal/errors.ts";
import { emitWarning } from "../../internal/process-warning.ts";
import {
  validateBuffer,
  validateFunction,
  validateInt32,
  validateInteger,
  validateObject,
  validateOneOf,
  validateString,
  validateUint32,
} from "../../internal/validators.ts";
import {
  asymmetricHandle,
  encodePrivateKey,
  encodePublicKey,
  encodingCipher,
  parsePrivateKeyEncoding,
  parsePublicKeyEncoding,
  PrivateKeyObject,
  PublicKeyObject,
  SecretKeyObject,
  secretKeyObjectOf,
} from "./keys.ts";
import type { JsonWebKey, KeyEncoding } from "./keys.ts";
import { bytesOf, digestId, jobError } from "./util.ts";

/** What node's `KeyGenJob` says when OpenSSL queued nothing to say instead. */
const KEYGEN_FAILED = "Key generation job failed";

/** A generated key as the program receives it: a key object, or its encoding. */
export type GeneratedKey = PublicKeyObject | PrivateKeyObject | Buffer | string | JsonWebKey;

export interface KeyPair {
  publicKey: GeneratedKey;
  privateKey: GeneratedKey;
}

export interface KeyPairOptions {
  modulusLength?: unknown;
  publicExponent?: unknown;
  hashAlgorithm?: unknown;
  mgf1HashAlgorithm?: unknown;
  hash?: unknown;
  mgf1Hash?: unknown;
  saltLength?: unknown;
  divisorLength?: unknown;
  namedCurve?: unknown;
  paramEncoding?: unknown;
  group?: unknown;
  prime?: unknown;
  primeLength?: unknown;
  generator?: unknown;
  publicKeyEncoding?: unknown;
  privateKeyEncoding?: unknown;
}

type KeyPairCallback = (error: Error | null, publicKey?: GeneratedKey, privateKey?: GeneratedKey) => void;

/** The encodings a key pair asks for; undefined asks for key objects. */
interface PairEncoding {
  publicEncoding: KeyEncoding | undefined;
  privateEncoding: KeyEncoding | undefined;
}

/** Node's `parseKeyEncoding`, for the two halves of a pair. */
function parsePairEncoding(keyType: string, options: KeyPairOptions | undefined): PairEncoding {
  const publicKeyEncoding = options?.publicKeyEncoding;
  const privateKeyEncoding = options?.privateKeyEncoding;
  let publicEncoding: KeyEncoding | undefined;
  if (publicKeyEncoding !== undefined && publicKeyEncoding !== null) {
    if (typeof publicKeyEncoding !== "object") {
      throw new ERR_INVALID_ARG_VALUE("options.publicKeyEncoding", publicKeyEncoding);
    }
    publicEncoding = parsePublicKeyEncoding(publicKeyEncoding, keyType, "options.publicKeyEncoding");
  }
  let privateEncoding: KeyEncoding | undefined;
  if (privateKeyEncoding !== undefined && privateKeyEncoding !== null) {
    if (typeof privateKeyEncoding !== "object") {
      throw new ERR_INVALID_ARG_VALUE("options.privateKeyEncoding", privateKeyEncoding);
    }
    privateEncoding = parsePrivateKeyEncoding(privateKeyEncoding, keyType, "options.privateKeyEncoding");
  }
  return { publicEncoding, privateEncoding };
}

/** A digest an RSA-PSS key is restricted to, refused as C++ refuses it; -1 is none. */
function pssDigest(name: string | undefined, what: string): number {
  if (name === undefined) return -1;
  const id = digestId(name);
  if (id < 0) throw new ERR_CRYPTO_INVALID_DIGEST_BINDING(`${what}: ${name}`);
  return id;
}

/** Node's DEP0154 for the two option names `hashAlgorithm` and `mgf1HashAlgorithm` replaced. */
function deprecatedHashOption(value: unknown, name: string, replacement: string, current: unknown): void {
  if (value === undefined) return;
  emitWarning(`"options.${name}" is deprecated, use "options.${replacement}" instead.`, "DeprecationWarning", "DEP0154");
  validateString(value, `options.${name}`);
  if (current && value !== current) throw new ERR_INVALID_ARG_VALUE(`options.${name}`, value);
}

/**
 * A job configured, as node's `createJob` and the job's constructor make it:
 * its handle in `keygen.c`, and how its keys are to be returned.
 */
interface KeyPairJob {
  handle: number;
  encoding: PairEncoding;
  cipher: number;
}

function rsaJob(type: string, options: KeyPairOptions): number {
  validateObject(options, "options");
  const modulusLength = options.modulusLength;
  validateUint32(modulusLength, "options.modulusLength");
  let publicExponent = 0x10001;
  if (options.publicExponent !== undefined && options.publicExponent !== null) {
    validateUint32(options.publicExponent, "options.publicExponent");
    publicExponent = options.publicExponent + 0;
  }
  if (type === "rsa") return nts_crypto_keygen_rsa(false, modulusLength + 0, publicExponent, -1, -1, -1);

  const { hash, mgf1Hash, hashAlgorithm, mgf1HashAlgorithm } = options;
  let saltLength = -1;
  if (options.saltLength !== undefined) {
    validateInt32(options.saltLength, "options.saltLength", 0);
    saltLength = options.saltLength + 0;
  }
  if (hashAlgorithm !== undefined) validateString(hashAlgorithm, "options.hashAlgorithm");
  if (mgf1HashAlgorithm !== undefined) validateString(mgf1HashAlgorithm, "options.mgf1HashAlgorithm");
  deprecatedHashOption(hash, "hash", "hashAlgorithm", hashAlgorithm);
  deprecatedHashOption(mgf1Hash, "mgf1Hash", "mgf1HashAlgorithm", mgf1HashAlgorithm);
  const digest = pssDigest((hashAlgorithm || hash) as string | undefined, "Invalid digest");
  const mgf1Digest = pssDigest((mgf1HashAlgorithm || mgf1Hash) as string | undefined, "Invalid MGF1 digest");
  return nts_crypto_keygen_rsa(true, modulusLength + 0, publicExponent, digest, mgf1Digest, saltLength);
}

function dsaJob(options: KeyPairOptions): number {
  validateObject(options, "options");
  const modulusLength = options.modulusLength;
  validateUint32(modulusLength, "options.modulusLength");
  let divisorLength = -1;
  if (options.divisorLength !== undefined && options.divisorLength !== null) {
    validateInt32(options.divisorLength, "options.divisorLength", 0);
    divisorLength = options.divisorLength + 0;
  }
  return nts_crypto_keygen_dsa(modulusLength + 0, divisorLength);
}

function ecJob(options: KeyPairOptions): number {
  validateObject(options, "options");
  const namedCurve = options.namedCurve;
  validateString(namedCurve, "options.namedCurve");
  const paramEncoding = options.paramEncoding;
  let explicit = false;
  if (paramEncoding === "explicit") explicit = true;
  else if (paramEncoding !== undefined && paramEncoding !== null && paramEncoding !== "named") {
    throw new ERR_INVALID_ARG_VALUE("options.paramEncoding", paramEncoding);
  }
  if (!nts_crypto_key_curve_known(namedCurve)) throw new ERR_CRYPTO_INVALID_CURVE();
  return nts_crypto_keygen_ec(namedCurve, explicit);
}

function dhJob(options: KeyPairOptions): number {
  validateObject(options, "options");
  const { group, prime, primeLength, generator } = options;
  if (group !== undefined && group !== null) {
    if (prime !== undefined && prime !== null) throw new ERR_INCOMPATIBLE_OPTION_PAIR("group", "prime");
    if (primeLength !== undefined && primeLength !== null) {
      throw new ERR_INCOMPATIBLE_OPTION_PAIR("group", "primeLength");
    }
    if (generator !== undefined && generator !== null) throw new ERR_INCOMPATIBLE_OPTION_PAIR("group", "generator");
    validateString(group, "options.group");
    const job = nts_crypto_keygen_dh_group(group);
    if (job === 0) throw new ERR_CRYPTO_UNKNOWN_DH_GROUP();
    return job;
  }
  let size = -1;
  if (prime !== undefined && prime !== null) {
    if (primeLength !== undefined && primeLength !== null) {
      throw new ERR_INCOMPATIBLE_OPTION_PAIR("prime", "primeLength");
    }
    validateBuffer(prime, "options.prime");
  } else if (primeLength !== undefined && primeLength !== null) {
    validateInt32(primeLength, "options.primeLength", 0);
    size = primeLength + 0;
  } else {
    throw new ERR_MISSING_OPTION("At least one of the group, prime, or primeLength options");
  }
  let g = 2;
  if (generator !== undefined && generator !== null) {
    validateInt32(generator, "options.generator", 0);
    g = generator + 0;
  }
  if (size >= 0) return nts_crypto_keygen_dh_size(size, g);
  return nts_crypto_keygen_dh_prime(bytesOf(prime as ArrayBufferView), g);
}

/** Node's `createJob`, and the job's C++ configuration after it. */
function createJob(type: unknown, options: unknown): KeyPairJob {
  validateString(type, "type");
  if (options !== undefined) validateObject(options, "options");
  const given = options as KeyPairOptions | undefined;
  const encoding = parsePairEncoding(type, given);

  let handle: number;
  switch (type) {
    case "rsa":
    case "rsa-pss":
      handle = rsaJob(type, given as KeyPairOptions);
      break;
    case "dsa":
      handle = dsaJob(given as KeyPairOptions);
      break;
    case "ec":
      handle = ecJob(given as KeyPairOptions);
      break;
    case "dh":
      handle = dhJob(given as KeyPairOptions);
      break;
    default:
      handle = nts_crypto_keygen_nid(type);
      if (handle === 0) throw new ERR_INVALID_ARG_VALUE("type", type, "must be a supported key type");
  }
  // The private key's cipher is resolved last, as `KeyPairGenTraits` resolves
  // it after the family's own configuration.
  let cipher = -1;
  try {
    if (encoding.privateEncoding !== undefined) cipher = encodingCipher(encoding.privateEncoding.cipher);
  } catch (error) {
    nts_crypto_keygen_release(handle);
    throw error;
  }
  return { handle, encoding, cipher };
}

/** `KeyPairGenTraits::EncodeKey`: key objects, or the encodings asked for. */
function encodePair(job: KeyPairJob, key: number): KeyPair {
  const publicKey = new PublicKeyObject(asymmetricHandle(key));
  const privateKey = new PrivateKeyObject(asymmetricHandle(key));
  const { publicEncoding, privateEncoding } = job.encoding;
  return {
    publicKey: publicEncoding === undefined ? publicKey : encodePublicKey(publicKey, publicEncoding),
    privateKey: privateEncoding === undefined ? privateKey : encodePrivateKey(privateKey, privateEncoding, job.cipher),
  };
}

/** `crypto.generateKeyPairSync(type, options)`. */
export function generateKeyPairSync(type: unknown, options?: unknown): KeyPair {
  const job = createJob(type, options);
  const key = nts_crypto_keygen_run(job.handle);
  if (key === 0) throw jobError(KEYGEN_FAILED);
  return encodePair(job, key);
}

/** `crypto.generateKeyPair(type, options, callback)`, whose options may be left out. */
export function generateKeyPair(type: unknown, options: unknown, callback?: unknown): void {
  if (typeof options === "function") {
    callback = options;
    options = undefined;
  }
  validateFunction(callback, "callback");
  queueKeyPair(createJob(type, options), callback as KeyPairCallback);
}

/** A key pair generated on the thread pool, delivered as node's `CryptoJob` delivers it. */
function queueKeyPair(job: KeyPairJob, done: KeyPairCallback): void {
  const request = new AsyncRequest("KEYPAIRGENREQUEST", getDefaultTriggerAsyncId());
  nts_crypto_keygen_queue(job.handle, (ok, key) => {
    const failure = ok ? null : jobError(KEYGEN_FAILED);
    request.complete(() => {
      if (failure !== null) {
        done(failure);
        return;
      }
      // An encoding that fails is the job's error, as `ToResult` catches it.
      let pair: KeyPair;
      try {
        pair = encodePair(job, key);
      } catch (error) {
        done(error as Error);
        return;
      }
      done(null, pair.publicKey, pair.privateKey);
    });
  });
}

// -- secret keys --------------------------------------------------------------

export interface SecretKeyOptions {
  length?: unknown;
}

type SecretKeyCallback = (error: Error | null, key?: SecretKeyObject) => void;

/** Node's `generateKeyJob`: the key's length in bytes, once the type allows it. */
function secretKeyLength(type: unknown, options: unknown): number {
  validateString(type, "type");
  validateObject(options, "options");
  const length = (options as SecretKeyOptions).length;
  switch (type) {
    case "hmac":
      validateInteger(length, "options.length", 8, 2 ** 31 - 1);
      break;
    case "aes":
      validateOneOf(length, "options.length", [128, 192, 256]);
      break;
    default:
      throw new ERR_INVALID_ARG_VALUE("type", type, "must be a supported key type");
  }
  // `SecretKeyGenTraits` keeps whole bytes: an HMAC length of 10 bits is one.
  return Math.floor((length as number) / 8);
}

/** `crypto.generateKeySync(type, options)`. */
export function generateKeySync(type: unknown, options: unknown): SecretKeyObject {
  const bytes = new Uint8Array(secretKeyLength(type, options));
  if (!nts_crypto_random_fill(bytes, 0, bytes.byteLength)) throw jobError(KEYGEN_FAILED);
  return secretKeyObjectOf(bytes);
}

/** `crypto.generateKey(type, options, callback)`. */
export function generateKey(type: unknown, options: unknown, callback?: unknown): void {
  if (typeof options === "function") {
    callback = options;
    options = undefined;
  }
  validateFunction(callback, "callback");
  queueSecretKey(secretKeyLength(type, options), callback as SecretKeyCallback);
}

/** A secret key's bytes drawn on the thread pool. */
function queueSecretKey(length: number, done: SecretKeyCallback): void {
  const bytes = new Uint8Array(length);
  const request = new AsyncRequest("KEYGENREQUEST", getDefaultTriggerAsyncId());
  nts_crypto_random_fill_job(bytes, 0, bytes.byteLength, (ok) => {
    const failure = ok ? null : jobError(KEYGEN_FAILED);
    request.complete(() => {
      if (failure !== null) done(failure);
      else done(null, secretKeyObjectOf(bytes));
    });
  });
}
