// Key agreement: `DiffieHellman`, `DiffieHellmanGroup`, `ECDH` and
// `crypto.diffieHellman`, from node v24.20.0
// `lib/internal/crypto/diffiehellman.js`, over `src/crypto/crypto_dh.cc` and
// `crypto_ec.cc` (here `dh.c`).
//
// Node's two DH classes are functions sharing one set of prototype methods,
// and `DiffieHellmanGroup` has no setters. Here they share a base class that
// is not exported, which is the same sharing with one more prototype on the
// chain.

import { Buffer } from "../../buffer/src/main.ts";
import { getDefaultTriggerAsyncId } from "../../internal/async-hooks.ts";
import { AsyncRequest } from "../../internal/async-request.ts";
import {
  ERR_CRYPTO_ECDH_INVALID_FORMAT,
  ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY,
  ERR_CRYPTO_INCOMPATIBLE_KEY,
  ERR_CRYPTO_INVALID_CURVE,
  ERR_CRYPTO_INVALID_KEYLEN,
  ERR_CRYPTO_INVALID_KEYPAIR,
  ERR_CRYPTO_INVALID_KEYTYPE,
  ERR_CRYPTO_INVALID_STATE_BINDING,
  ERR_CRYPTO_OPERATION_FAILED,
  ERR_CRYPTO_UNKNOWN_DH_GROUP,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_TYPE_BINDING,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_ARG_VALUE_BINDING,
} from "../../internal/errors.ts";
import { emitWarning } from "../../internal/process-warning.ts";
import { validateFunction, validateInt32, validateObject, validateString } from "../../internal/validators.ts";
import { isAnyArrayBuffer, isArrayBufferView } from "../../util/src/types.ts";
import { constants } from "./constants.ts";
import {
  asymmetricKeyTypeOfKey,
  isKeyObject,
  preparePrivateKey,
  preparePublicOrPrivateKey,
  privateKeyOf,
  publicOrPrivateKeyOf,
  typeOf,
} from "./keys.ts";
import { asBuffer, bytesOf, cryptoError, getArrayBufferOrView, jobError, queuedCryptoError, toBuf } from "./util.ts";
import type { ByteSource } from "./util.ts";

/** `dh.c`'s answers from making a `DiffieHellman`, besides a handle. */
const DhStatus = { InvalidParameters: -1, InvalidPrime: -2, BadGenerator: -3, BadPrimeLength: -4 } as const;

/** `dh.c`'s reasons a secret was not computed. */
const SecretStatus = { CheckFailed: -1, TooSmall: -2, TooLarge: -3, Invalid: -4 } as const;

/** `dh.c`'s answers for an `ECDH`. */
const EcdhStatus = { Ok: 1, InvalidCurve: -1, InvalidKeyPair: -2, InvalidPublicKey: -3, InvalidPrivateKey: -5 } as const;

/** What node's `DeriveBitsJob` says when OpenSSL queued nothing to say instead. */
const DERIVE_FAILED = "Deriving bits failed";

const DH_GENERATOR = 2;

const BINARY_SOURCES = ["number", "string", "ArrayBuffer", "Buffer", "TypedArray", "DataView"];

/** Node's `encode`: the bytes, or their text in an encoding other than `buffer`. */
function encode(bytes: Uint8Array, encoding: unknown): Buffer | string {
  const buffer = asBuffer(bytes);
  if (encoding && encoding !== "buffer") return buffer.toString(encoding as string);
  return buffer;
}

/** An encoding argument as `toBuf` and `Buffer.from` read one: a string, or UTF-8. */
function encodingOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** `DH_check`'s flags, read once as the object is made, as node reads them. */
function verifyErrorOf(handle: number): number {
  const codes = nts_crypto_dh_check(handle);
  if (codes < 0) throw new ERR_CRYPTO_OPERATION_FAILED("Checking DH parameters failed");
  return codes;
}

/** A handle, or the error node's C++ constructor throws for the status. */
function constructed(handle: number): number {
  if (handle > 0) return handle;
  switch (handle) {
    case DhStatus.BadPrimeLength:
      throw cryptoError("Invalid prime length");
    case DhStatus.BadGenerator:
      throw cryptoError("Invalid generator");
    case DhStatus.InvalidPrime:
      throw new ERR_INVALID_ARG_VALUE_BINDING("Invalid prime");
    default:
      throw new ERR_INVALID_ARG_VALUE_BINDING("Invalid DH parameters");
  }
}

/** What both DH classes share: node assigns these functions to both prototypes. */
class DiffieHellmanBase {
  readonly #handle: number;
  /**
   * An own, enumerable property, as node's is. Node's is also not writable,
   * which takes descriptor reflection that a compiled program's fixed layout
   * does not have; `readonly` is the TypeScript half of the same promise.
   */
  readonly verifyError: number;

  constructor(handle: number) {
    this.#handle = handle;
    this.verifyError = verifyErrorOf(handle);
  }

  protected get handle(): number {
    return this.#handle;
  }

  generateKeys(encoding?: unknown): Buffer | string {
    const keys = nts_crypto_dh_generate_keys(this.#handle);
    if (keys === null) throw new ERR_CRYPTO_OPERATION_FAILED("Key generation failed");
    return encode(keys, encoding);
  }

  computeSecret(key: unknown, inputEncoding?: unknown, outputEncoding?: unknown): Buffer | string {
    const bytes = bytesOf(getArrayBufferOrView(key, "key", encodingOf(inputEncoding)));
    const secret = nts_crypto_dh_compute_secret(this.#handle, bytes);
    if (secret === null) {
      switch (nts_crypto_dh_status()) {
        case SecretStatus.CheckFailed:
          throw new ERR_CRYPTO_INVALID_KEYTYPE("Unspecified validation error");
        case SecretStatus.TooSmall:
          throw new ERR_CRYPTO_INVALID_KEYLEN("Supplied key is too small");
        case SecretStatus.TooLarge:
          throw new ERR_CRYPTO_INVALID_KEYLEN("Supplied key is too large");
        case SecretStatus.Invalid:
          throw new ERR_CRYPTO_INVALID_KEYTYPE("Supplied key is invalid");
        default:
          throw new ERR_CRYPTO_OPERATION_FAILED("Failed to compute shared secret");
      }
    }
    return encode(secret, outputEncoding);
  }

  getPrime(encoding?: unknown): Buffer | string {
    return encode(this.#part(0, "p is null"), encoding);
  }

  getGenerator(encoding?: unknown): Buffer | string {
    return encode(this.#part(1, "g is null"), encoding);
  }

  getPublicKey(encoding?: unknown): Buffer | string {
    return encode(this.#part(2, "No public key - did you forget to generate one?"), encoding);
  }

  getPrivateKey(encoding?: unknown): Buffer | string {
    return encode(this.#part(3, "No private key - did you forget to generate one?"), encoding);
  }

  #part(which: number, missing: string): Uint8Array {
    const bytes = nts_crypto_dh_get(this.#handle, which);
    if (bytes === null) throw new ERR_CRYPTO_INVALID_STATE_BINDING(missing);
    return bytes;
  }
}

/** Node's `DiffieHellman` constructor, after its argument juggling: C++'s `New`. */
function newDiffieHellman(sizeOrKey: number | ByteSource, generator: number | ByteSource): number {
  if (typeof sizeOrKey === "number") {
    // "If the first argument is an Int32 then we are generating a new prime
    // ... The second argument must be an Int32 as well."
    if (typeof generator !== "number") {
      throw new ERR_INVALID_ARG_TYPE_BINDING("Second argument must be an int32");
    }
    return constructed(nts_crypto_dh_new_size(sizeOrKey, generator));
  }
  const prime = bytesOf(sizeOrKey);
  if (typeof generator === "number") return constructed(nts_crypto_dh_new_prime(prime, generator));
  return constructed(nts_crypto_dh_new_prime_generator(prime, bytesOf(generator)));
}

/** Node's argument handling, before C++ sees any of it. */
function diffieHellmanHandle(
  sizeOrKey: unknown,
  keyEncoding: unknown,
  generator: unknown,
  genEncoding: unknown,
): number {
  if (
    typeof sizeOrKey !== "number" &&
    typeof sizeOrKey !== "string" &&
    !isArrayBufferView(sizeOrKey) &&
    !isAnyArrayBuffer(sizeOrKey)
  ) {
    throw new ERR_INVALID_ARG_TYPE("sizeOrKey", BINARY_SOURCES, sizeOrKey);
  }
  // Sizes below 0 are accepted here and refused by OpenSSL, as node has it.
  if (typeof sizeOrKey === "number") validateInt32(sizeOrKey, "sizeOrKey");
  // An encoding that is none is the generator, moved up one place.
  const isEncoding = typeof keyEncoding === "string" && Buffer.isEncoding(keyEncoding);
  if (keyEncoding && !isEncoding && keyEncoding !== "buffer") {
    genEncoding = generator;
    generator = keyEncoding;
    keyEncoding = false;
  }
  const key =
    typeof sizeOrKey === "number" ? sizeOrKey + 0 : (toBuf(sizeOrKey, encodingOf(keyEncoding)) as ByteSource);
  let g: number | ByteSource;
  if (!generator) {
    g = DH_GENERATOR;
  } else if (typeof generator === "number") {
    validateInt32(generator, "generator");
    g = generator;
  } else if (typeof generator === "string") {
    g = toBuf(generator, encodingOf(genEncoding)) as ByteSource;
  } else if (isArrayBufferView(generator) || isAnyArrayBuffer(generator)) {
    g = generator;
  } else {
    throw new ERR_INVALID_ARG_TYPE("generator", BINARY_SOURCES, generator);
  }
  return newDiffieHellman(key, g);
}

export class DiffieHellman extends DiffieHellmanBase {
  constructor(sizeOrKey: unknown, keyEncoding?: unknown, generator?: unknown, genEncoding?: unknown) {
    super(diffieHellmanHandle(sizeOrKey, keyEncoding, generator, genEncoding));
  }

  setPublicKey(key: unknown, encoding?: unknown): this {
    const bytes = bytesOf(getArrayBufferOrView(key, "key", encodingOf(encoding)));
    if (!nts_crypto_dh_set_key(this.handle, bytes, false)) throw new ERR_INVALID_ARG_VALUE_BINDING("Invalid public key");
    return this;
  }

  setPrivateKey(key: unknown, encoding?: unknown): this {
    const bytes = bytesOf(getArrayBufferOrView(key, "key", encodingOf(encoding)));
    if (!nts_crypto_dh_set_key(this.handle, bytes, true)) throw new ERR_INVALID_ARG_VALUE_BINDING("Invalid private key");
    return this;
  }
}

/** C++'s `DiffieHellmanGroup`, which checks its argument itself. */
function groupHandle(name: unknown): number {
  if (typeof name !== "string") throw new ERR_INVALID_ARG_TYPE_BINDING("Group name must be a string");
  const handle = nts_crypto_dh_group(name);
  if (handle <= 0) throw new ERR_CRYPTO_UNKNOWN_DH_GROUP();
  return handle;
}

export class DiffieHellmanGroup extends DiffieHellmanBase {
  constructor(name: unknown) {
    super(groupHandle(name));
  }
}

export function createDiffieHellman(
  sizeOrKey: unknown,
  keyEncoding?: unknown,
  generator?: unknown,
  genEncoding?: unknown,
): DiffieHellman {
  return new DiffieHellman(sizeOrKey, keyEncoding, generator, genEncoding);
}

/** `crypto.getDiffieHellman(groupName)`, also `createDiffieHellmanGroup`. */
export function getDiffieHellman(groupName: unknown): DiffieHellmanGroup {
  return new DiffieHellmanGroup(groupName);
}

// -- ECDH ---------------------------------------------------------------------

/** Node's `getFormat`: a point's encoding, uncompressed unless asked. */
function getFormat(format: unknown): number {
  if (format) {
    if (format === "compressed") return constants.POINT_CONVERSION_COMPRESSED;
    if (format === "hybrid") return constants.POINT_CONVERSION_HYBRID;
    if (format !== "uncompressed") {
      throw new ERR_CRYPTO_ECDH_INVALID_FORMAT(typeof format === "string" ? format : String(format));
    }
  }
  return constants.POINT_CONVERSION_UNCOMPRESSED;
}

let warnedSetPublicKey = false;

export class ECDH {
  readonly #handle: number;

  constructor(curve: unknown) {
    validateString(curve, "curve");
    const handle = nts_crypto_ecdh_new(curve);
    if (handle === EcdhStatus.InvalidCurve) throw new ERR_CRYPTO_INVALID_CURVE();
    if (handle <= 0) throw new ERR_CRYPTO_OPERATION_FAILED("Failed to create key using named curve");
    this.#handle = handle;
  }

  /** `ECDH.convertKey(key, curve[, inputEncoding[, outputEncoding[, format]]])`. */
  static convertKey(
    key: unknown,
    curve: unknown,
    inputEncoding?: unknown,
    outputEncoding?: unknown,
    format?: unknown,
  ): Buffer | string {
    validateString(curve, "curve");
    const bytes = bytesOf(getArrayBufferOrView(key, "key", encodingOf(inputEncoding)));
    const form = getFormat(format);
    // An empty key converts to an empty string, whatever the encodings.
    if (bytes.byteLength === 0) return "";
    const converted = nts_crypto_ecdh_convert_key(bytes, curve, form);
    if (converted === null) {
      switch (nts_crypto_dh_status()) {
        case EcdhStatus.InvalidCurve:
          throw new ERR_CRYPTO_INVALID_CURVE();
        case EcdhStatus.InvalidPublicKey:
          throw new ERR_CRYPTO_OPERATION_FAILED("Failed to convert Buffer to EC_POINT");
        default:
          throw new ERR_CRYPTO_OPERATION_FAILED("Failed to get public key");
      }
    }
    return encode(converted, outputEncoding);
  }

  generateKeys(encoding?: unknown, format?: unknown): Buffer | string {
    if (!nts_crypto_ecdh_generate_keys(this.#handle)) throw new ERR_CRYPTO_OPERATION_FAILED("Failed to generate key");
    return this.getPublicKey(encoding, format);
  }

  computeSecret(key: unknown, inputEncoding?: unknown, outputEncoding?: unknown): Buffer | string {
    const bytes = bytesOf(getArrayBufferOrView(key, "key", encodingOf(inputEncoding)));
    const secret = nts_crypto_ecdh_compute_secret(this.#handle, bytes);
    if (secret === null) {
      switch (nts_crypto_dh_status()) {
        case EcdhStatus.InvalidKeyPair:
          throw new ERR_CRYPTO_INVALID_KEYPAIR();
        case EcdhStatus.InvalidPublicKey:
          throw new ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY();
        default:
          throw new ERR_CRYPTO_OPERATION_FAILED("Failed to compute ECDH key");
      }
    }
    return encode(secret, outputEncoding);
  }

  getPublicKey(encoding?: unknown, format?: unknown): Buffer | string {
    const form = getFormat(format);
    const key = nts_crypto_ecdh_get_public_key(this.#handle, form);
    if (key === null) throw new ERR_CRYPTO_OPERATION_FAILED("Failed to get ECDH public key");
    return encode(key, encoding);
  }

  getPrivateKey(encoding?: unknown): Buffer | string {
    const key = nts_crypto_ecdh_get_private_key(this.#handle);
    if (key === null) throw new ERR_CRYPTO_OPERATION_FAILED("Failed to get ECDH private key");
    return encode(key, encoding);
  }

  setPrivateKey(key: unknown, encoding?: unknown): this {
    const bytes = bytesOf(getArrayBufferOrView(key, "key", encodingOf(encoding)));
    const status = nts_crypto_ecdh_set_private_key(this.#handle, bytes);
    if (status === EcdhStatus.InvalidPrivateKey) {
      throw new ERR_CRYPTO_INVALID_KEYTYPE("Private key is not valid for specified curve.");
    }
    if (status !== EcdhStatus.Ok) throw new ERR_CRYPTO_OPERATION_FAILED("Failed to convert BN to a private key");
    return this;
  }

  /** Deprecated (DEP0031): a public key alone is no key pair. */
  setPublicKey(key: unknown, encoding?: unknown): this {
    if (!warnedSetPublicKey) {
      warnedSetPublicKey = true;
      emitWarning("ecdh.setPublicKey() is deprecated.", "DeprecationWarning", "DEP0031");
    }
    const bytes = bytesOf(getArrayBufferOrView(key, "key", encodingOf(encoding)));
    const status = nts_crypto_ecdh_set_public_key(this.#handle, bytes);
    if (status === EcdhStatus.InvalidPublicKey) {
      throw new ERR_CRYPTO_OPERATION_FAILED("Failed to convert Buffer to EC_POINT");
    }
    if (status !== EcdhStatus.Ok) throw new ERR_CRYPTO_OPERATION_FAILED("Failed to set EC_POINT as the public key");
    return this;
  }
}

export function createECDH(curve: unknown): ECDH {
  return new ECDH(curve);
}

// -- crypto.diffieHellman -----------------------------------------------------

export interface DiffieHellmanOptions {
  privateKey?: unknown;
  publicKey?: unknown;
}

type SecretCallback = (error: Error | null, secret?: Buffer) => void;

/** The key types `diffieHellman` agrees keys of. */
const dhEnabledKeyTypes = ["dh", "ec", "x448", "x25519"];

/** Node's check of two key objects before anything is parsed. */
function checkKeyTypes(privateKey: unknown, publicKey: unknown): void {
  if (!isKeyObject(privateKey) || typeOf(privateKey) !== "private") return;
  if (!isKeyObject(publicKey) || typeOf(publicKey) === "secret") return;
  const privateType = asymmetricKeyTypeOfKey(privateKey);
  const publicType = asymmetricKeyTypeOfKey(publicKey);
  if (privateType !== publicType || !dhEnabledKeyTypes.includes(privateType ?? "")) {
    throw new ERR_CRYPTO_INCOMPATIBLE_KEY("key types for Diffie-Hellman", `${privateType} and ${publicType}`);
  }
}

/** `crypto.diffieHellman({ privateKey, publicKey }[, callback])`: node's `DHBitsJob`. */
export function diffieHellman(options: unknown, callback?: unknown): Buffer | undefined {
  validateObject(options, "options");
  if (callback !== undefined) validateFunction(callback, "callback");
  const { privateKey, publicKey } = options as DiffieHellmanOptions;
  if (privateKey === undefined) throw new ERR_INVALID_ARG_VALUE("options.privateKey", privateKey);
  if (publicKey === undefined) throw new ERR_INVALID_ARG_VALUE("options.publicKey", publicKey);
  checkKeyTypes(privateKey, publicKey);
  const preparedPublic = preparePublicOrPrivateKey(publicKey, "options.publicKey");
  const preparedPrivate = preparePrivateKey(privateKey, "options.privateKey");

  const theirs = publicOrPrivateKeyOf(preparedPublic).native;
  const ours = privateKeyOf(preparedPrivate).native;
  if (callback === undefined) {
    const secret = nts_crypto_dh_stateless(ours, theirs);
    // The synchronous job throws OpenSSL's reason when it has one.
    if (secret === null) throw queuedCryptoError() ?? jobError(DERIVE_FAILED);
    return asBuffer(secret);
  }
  queueSecret(ours, theirs, callback as SecretCallback);
  return undefined;
}

function queueSecret(ours: number, theirs: number, done: SecretCallback): void {
  const request = new AsyncRequest("DERIVEBITSREQUEST", getDefaultTriggerAsyncId());
  nts_crypto_dh_stateless_job(ours, theirs, (ok, secret) => {
    const failure = ok ? null : jobError(DERIVE_FAILED);
    request.complete(() => {
      if (failure !== null) done(failure);
      else done(null, asBuffer(secret));
    });
  });
}
