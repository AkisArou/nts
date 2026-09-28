// The native half of `node:crypto`, for the node-side run only.
//
// Every computation is OpenSSL either way. Here it is reached through node's
// own `crypto`, the same library behind the same seam, so a disagreement is
// about this module's assembly -- validation, encodings, streams, the shape of
// its errors -- rather than about a digest.
//
// Errors cross back as `crypto.c` records them: the OpenSSL errors oldest
// first, with the oldest one's library, reason and code. Node has already
// assembled them into an exception, so this takes that apart again: its
// message is the oldest, and its `opensslErrorStack` is the rest, newest
// first. An exception with no OpenSSL content -- node's own words for the
// operation -- is an empty record, and the TypeScript supplies the same words.
import "../internal/bindings.node.mjs";
import "../stream/bindings.node.mjs";
import crypto from "node:crypto";

const empty = () => ["", "", ""];

/** Taken at load, as C's decoding is out of a program's reach: tests replace the global. */
const bufferFrom = Buffer.from.bind(Buffer);
let record = empty();

function fromOpenSSL(error) {
  const message = String(error?.message ?? "");
  const stack = Array.isArray(error?.opensslErrorStack) ? error.opensslErrorStack : [];
  if (!message.startsWith("error:") && stack.length === 0) return empty();
  const code = typeof error.code === "string" && error.code.startsWith("ERR_OSSL") ? error.code : "";
  // Oldest first. A peeked error -- ciphers, keys -- is already the oldest
  // entry of its own stack; a taken one is not on it.
  const errors = [...stack].reverse();
  if (errors[0] !== message) errors.unshift(message);
  return [error.library ?? "", error.reason ?? "", code, ...errors];
}

/**
 * Node decorates its exception by assigning these, so an accessor a program
 * put on `Object.prototype` for one of them runs inside node's crypto, and
 * what it throws replaces node's error (`test-crypto-sign-verify` does this).
 * The TypeScript's own decoration assigns the same names in the same order,
 * and would throw the same thing at the same step.
 */
const DECORATIONS = ["library", "reason", "code", "opensslErrorStack"];

function decoratedByProgram() {
  return DECORATIONS.some((name) => Object.getOwnPropertyDescriptor(Object.prototype, name)?.set !== undefined);
}

function failed(error) {
  record = fromOpenSSL(error);
  // What a program's setter threw is not an OpenSSL error, and passes through.
  if (record.length === 3 && decoratedByProgram()) {
    record = empty();
    throw error;
  }
}

globalThis.nts_crypto_take_errors = () => {
  const taken = record;
  record = empty();
  return taken;
};

// -- digests ------------------------------------------------------------------

const names = [];
const ids = new Map();

/**
 * Node's refusal for a name it does not know, as distinct from one it cannot
 * run. Asked through `hash` with an explicit length, which never warns DEP0198:
 * an unknown name is refused by name before the length is looked at.
 */
function unknownDigest(name) {
  try {
    crypto.hash(name, "", { outputLength: 0 });
    return false;
  } catch (error) {
    return error?.message === `Digest method ${name} is not supported`;
  }
}

globalThis.nts_crypto_digest_id = (name) => {
  const known = ids.get(name);
  if (known !== undefined) return known;
  if (unknownDigest(name)) return -1;
  const id = names.push(name) - 1;
  ids.set(name, id);
  return id;
};

/**
 * SHAKE's default length, which `crypto.c` fills in by the digest's NID. Passed
 * explicitly here because node, asked without one, would warn DEP0198 itself
 * and a test counting that warning would see two.
 */
const SHAKE_DEFAULTS = new Map([
  ["shake128", 16],
  ["shake-128", 16],
  ["id-shake128", 16],
  ["2.16.840.1.101.3.4.2.11", 16],
  ["shake256", 32],
  ["shake-256", 32],
  ["id-shake256", 32],
  ["2.16.840.1.101.3.4.2.12", 32],
]);

function lengthOptions(id, xofLength) {
  if (xofLength >= 0) return { outputLength: xofLength };
  const fallback = SHAKE_DEFAULTS.get(names[id].toLowerCase());
  return fallback === undefined ? undefined : { outputLength: fallback };
}

globalThis.nts_crypto_digest_is_xof = (id) => {
  try {
    crypto.createHash(names[id], { outputLength: 1 });
    return true;
  } catch {
    return false;
  }
};

globalThis.nts_crypto_digest_size = (id) => {
  if (globalThis.nts_crypto_digest_is_xof(id)) return 0;
  try {
    return crypto.hash(names[id], "", "buffer").length;
  } catch {
    return 0;
  }
};

globalThis.nts_crypto_hash_names = () => crypto.getHashes();

// -- contexts -----------------------------------------------------------------

let nextHandle = 1;
const contexts = new Map();

function claim(context) {
  const handle = nextHandle++;
  contexts.set(handle, context);
  return handle;
}

globalThis.nts_crypto_hash_new = (id, xofLength) => {
  try {
    return claim(crypto.createHash(names[id], lengthOptions(id, xofLength)));
  } catch (error) {
    failed(error);
    return 0;
  }
};

globalThis.nts_crypto_hash_copy = (handle, xofLength) => {
  const context = contexts.get(handle);
  if (context === undefined) return 0;
  try {
    return claim(context.copy(xofLength >= 0 ? { outputLength: xofLength } : undefined));
  } catch (error) {
    failed(error);
    return 0;
  }
};

globalThis.nts_crypto_hmac_new = (id, key) => {
  try {
    return claim(crypto.createHmac(names[id], key));
  } catch (error) {
    failed(error);
    return 0;
  }
};

globalThis.nts_crypto_update = (handle, data) => {
  const context = contexts.get(handle);
  if (context === undefined) return false;
  context.update(data);
  return true;
};

globalThis.nts_crypto_update_utf8 = (handle, data) => {
  const context = contexts.get(handle);
  if (context === undefined) return false;
  context.update(data, "utf8");
  return true;
};

globalThis.nts_crypto_final = (handle) => {
  const context = contexts.get(handle);
  if (context === undefined) return null;
  contexts.delete(handle);
  try {
    const bytes = context.digest();
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } catch (error) {
    failed(error);
    return null;
  }
};

globalThis.nts_crypto_release = (handle) => {
  contexts.delete(handle);
};

function oneShot(id, input, length) {
  try {
    const options = { outputEncoding: "buffer", ...lengthOptions(id, length) };
    const bytes = crypto.hash(names[id], input, options);
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } catch (error) {
    failed(error);
    return null;
  }
}

globalThis.nts_crypto_digest = oneShot;
globalThis.nts_crypto_digest_utf8 = oneShot;

/**
 * The pool's work, computed at once and delivered on a later turn of the
 * loop, where `crypto.c` delivers it.
 */
function later(compute, done) {
  let bytes = null;
  try {
    bytes = compute();
  } catch (error) {
    failed(error);
  }
  setImmediate(() => done(bytes !== null, bytes ?? new Uint8Array(0)));
}

globalThis.nts_crypto_digest_job = (id, input, length, done) => later(() => oneShot(id, input, length), done);

globalThis.nts_crypto_hmac_job = (id, key, data, done) =>
  later(() => {
    const mac = crypto.createHmac(names[id], key).update(data).digest();
    return new Uint8Array(mac.buffer, mac.byteOffset, mac.byteLength);
  }, done);

// -- random -------------------------------------------------------------------

globalThis.nts_crypto_random_fill = (target, offset, size) => {
  try {
    crypto.randomFillSync(target, offset, size);
    return true;
  } catch (error) {
    failed(error);
    return false;
  }
};

globalThis.nts_crypto_random_fill_job = (target, offset, size, done) => {
  crypto.randomFill(target, offset, size, (error) => {
    if (error) failed(error);
    done(!error);
  });
};

// -- derivations --------------------------------------------------------------

const noBytes = new Uint8Array(0);
const view = (bytes) =>
  bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function sync(derive) {
  try {
    return view(derive());
  } catch (error) {
    failed(error);
    return null;
  }
}

function job(start, done) {
  start((error, bytes) => {
    if (error) {
      failed(error);
      done(false, noBytes);
      return;
    }
    done(true, view(bytes));
  });
}

globalThis.nts_crypto_pbkdf2 = (password, salt, iterations, length, id) =>
  sync(() => crypto.pbkdf2Sync(password, salt, iterations, length, names[id]));

globalThis.nts_crypto_pbkdf2_job = (password, salt, iterations, length, id, done) =>
  job((callback) => crypto.pbkdf2(password, salt, iterations, length, names[id], callback), done);

/** Node's own bound, asked with no key material worth deriving. */
globalThis.nts_crypto_hkdf_length_ok = (id, length) => {
  try {
    crypto.hkdfSync(names[id], "k", "", "", length);
    return true;
  } catch (error) {
    return error?.code !== "ERR_CRYPTO_INVALID_KEYLEN";
  }
};

globalThis.nts_crypto_hkdf = (id, key, salt, info, length) =>
  sync(() => crypto.hkdfSync(names[id], key, salt, info, length));

globalThis.nts_crypto_hkdf_job = (id, key, salt, info, length, done) =>
  job((callback) => crypto.hkdf(names[id], key, salt, info, length, callback), done);

/** Node's check, run by asking for nothing: the parameters are refused before any work. */
globalThis.nts_crypto_scrypt_valid = (n, r, p, maxmem) => {
  try {
    crypto.scryptSync("", "", 0, { N: n, r, p, maxmem });
    return true;
  } catch (error) {
    const reason = /^Invalid scrypt params: (.*)$/.exec(String(error?.message ?? ""));
    record = reason === null ? empty() : ["", "", "", reason[1]];
    return false;
  }
};

globalThis.nts_crypto_scrypt = (password, salt, n, r, p, maxmem, length) =>
  sync(() => crypto.scryptSync(password, salt, length, { N: n, r, p, maxmem }));

globalThis.nts_crypto_scrypt_job = (password, salt, n, r, p, maxmem, length, done) =>
  job((callback) => crypto.scrypt(password, salt, length, { N: n, r, p, maxmem }, callback), done);

globalThis.nts_crypto_timing_safe_equal = (a, b) => crypto.timingSafeEqual(a, b);

globalThis.nts_crypto_fips_enabled = () => crypto.getFips() === 1;

globalThis.nts_crypto_set_fips = (enable) => {
  try {
    crypto.setFips(enable);
    return true;
  } catch (error) {
    failed(error);
    return false;
  }
};

globalThis.nts_crypto_openssl_version_number = () => crypto.constants.OPENSSL_VERSION_NUMBER;

// -- ciphers ------------------------------------------------------------------

const cipherNames = [];
const cipherIds = new Map();
let cipherStatus = 0;

function registerCipher(name) {
  const known = cipherIds.get(name);
  if (known !== undefined) return known;
  const id = cipherNames.push(name) - 1;
  cipherIds.set(name, id);
  return id;
}

globalThis.nts_crypto_cipher_id = (name) => {
  if (cipherIds.has(name)) return cipherIds.get(name);
  return crypto.getCipherInfo(name) === undefined ? -1 : registerCipher(name);
};

globalThis.nts_crypto_cipher_id_of_nid = (nid) => {
  const info = crypto.getCipherInfo(nid);
  return info === undefined ? -1 : registerCipher(info.name);
};

globalThis.nts_crypto_cipher_names = () => crypto.getCiphers();
globalThis.nts_crypto_cipher_name = (id) => crypto.getCipherInfo(cipherNames[id])?.name ?? "";
globalThis.nts_crypto_cipher_mode = (id) => crypto.getCipherInfo(cipherNames[id])?.mode ?? "";

globalThis.nts_crypto_cipher_info = (id, keyLength, ivLength) => {
  const options = {};
  if (keyLength >= 0) options.keyLength = keyLength;
  if (ivLength >= 0) options.ivLength = ivLength;
  const info = crypto.getCipherInfo(cipherNames[id], options);
  if (info === undefined) return [];
  return [info.nid, info.blockSize ?? -1, info.ivLength ?? 0, info.keyLength];
};

const ciphers = new Map();
let nextCipher = 1;

/** Node's refusal, as the status `cipher.c` returns for it. */
function statusOf(error) {
  switch (error?.code) {
    case "ERR_CRYPTO_INVALID_IV": return -1;
    case "ERR_CRYPTO_INVALID_KEYLEN": return -2;
    case "ERR_CRYPTO_INVALID_AUTH_TAG":
      return /^authTagLength required/.test(error.message) ? -3 : -4;
    case "ERR_CRYPTO_UNSUPPORTED_OPERATION": return -5;
    case "ERR_CRYPTO_INVALID_MESSAGELEN": return -6;
    case "ERR_MISSING_ARGS": return -7;
    case "ERR_CRYPTO_INVALID_STATE": return -8;
    default: return 0;
  }
}

globalThis.nts_crypto_cipher_new = (id, encrypt, key, iv, authTagLength) => {
  const name = cipherNames[id];
  const options = authTagLength >= 0 ? { authTagLength } : undefined;
  try {
    const create = encrypt ? crypto.createCipheriv : crypto.createDecipheriv;
    const context = create(name, key, iv, options);
    const handle = nextCipher++;
    ciphers.set(handle, { context, mode: crypto.getCipherInfo(name)?.mode, authTagLength });
    return handle;
  } catch (error) {
    const status = statusOf(error);
    if (status === 0) failed(error);
    return status;
  }
};

function cipherUpdate(handle, data, encoding) {
  const cipher = ciphers.get(handle);
  cipherStatus = 0;
  if (cipher === undefined) return null;
  try {
    return view(cipher.context.update(data, encoding));
  } catch (error) {
    cipherStatus = statusOf(error);
    failed(error);
    return null;
  }
}

globalThis.nts_crypto_cipher_update = (handle, data) => cipherUpdate(handle, data, undefined);
globalThis.nts_crypto_cipher_update_utf8 = (handle, data) => cipherUpdate(handle, data, "utf8");

globalThis.nts_crypto_cipher_final = (handle) => {
  const cipher = ciphers.get(handle);
  if (cipher === undefined) {
    cipherStatus = -8;
    return null;
  }
  try {
    return view(cipher.context.final());
  } catch (error) {
    const invalidState = error?.code === "ERR_CRYPTO_INVALID_STATE";
    const unauthenticated = /^Unsupported state or unable to authenticate data/.test(String(error?.message));
    cipherStatus = invalidState ? -8 : unauthenticated ? -10 : 0;
    if (!invalidState) failed(error);
    return null;
  }
};

globalThis.nts_crypto_cipher_status = () => cipherStatus;

globalThis.nts_crypto_cipher_set_auto_padding = (handle, padding) => {
  try {
    ciphers.get(handle).context.setAutoPadding(padding);
    return true;
  } catch {
    return false;
  }
};

globalThis.nts_crypto_cipher_auth_tag = (handle) => {
  try {
    return view(ciphers.get(handle).context.getAuthTag());
  } catch {
    return null;
  }
};

/**
 * Node warns DEP0182 from C++ inside `setAuthTag`; the TypeScript warns from
 * the status, as it must when `cipher.c` is underneath. So node's own warning
 * is muted for the call and the condition reported the way `cipher.c`
 * reports it.
 */
globalThis.nts_crypto_cipher_set_auth_tag = (handle, tag) => {
  const cipher = ciphers.get(handle);
  cipherStatus = 1;
  if (cipher === undefined) return 0;
  const muted = process.noDeprecation;
  process.noDeprecation = true;
  try {
    cipher.context.setAuthTag(tag);
  } catch (error) {
    return statusOf(error) === -4 ? -4 : 0;
  } finally {
    process.noDeprecation = muted;
  }
  if (cipher.mode === "gcm" && cipher.authTagLength < 0 && tag.byteLength !== 16) cipherStatus = -9;
  return 1;
};

globalThis.nts_crypto_cipher_set_aad = (handle, aad, plaintextLength) => {
  try {
    ciphers.get(handle).context.setAAD(aad, plaintextLength >= 0 ? { plaintextLength } : undefined);
    return 1;
  } catch (error) {
    const status = statusOf(error);
    return status === -8 ? 0 : status;
  }
};

globalThis.nts_crypto_cipher_release = (handle) => {
  ciphers.delete(handle);
};

// -- asymmetric keys ----------------------------------------------------------

const keyObjects = [];
let keyStatus = 1;
const FORMATS = ["der", "pem"];
const ENCODINGS = ["pkcs1", "pkcs8", "spki", "sec1"];

function holdKey(key) {
  return keyObjects.push(key);
}

function keyAt(handle) {
  return keyObjects[handle - 1];
}

function parseKey(create, format, type, data, passphrase, hasPassphrase) {
  const options = { key: data, format: FORMATS[format] };
  if (type >= 0) options.type = ENCODINGS[type];
  if (hasPassphrase) options.passphrase = passphrase;
  try {
    return holdKey(create(options));
  } catch (error) {
    if (error?.code === "ERR_MISSING_PASSPHRASE") return -1;
    failed(error);
    return 0;
  }
}

globalThis.nts_crypto_key_parse_private = (format, type, data, passphrase, hasPassphrase) =>
  parseKey(crypto.createPrivateKey, format, type, data, passphrase, hasPassphrase);

/** A public request keeps whatever was parsed -- a private key answers for its public half. */
globalThis.nts_crypto_key_parse_public = (format, type, data, passphrase, hasPassphrase) => {
  const options = { key: data, format: FORMATS[format] };
  if (type >= 0) options.type = ENCODINGS[type];
  if (hasPassphrase) options.passphrase = passphrase;
  let publicKey;
  try {
    publicKey = crypto.createPublicKey(options);
  } catch (publicError) {
    // A private key parses as one, and keeps its private half here as it
    // does in `keys.c`, where the key object's type is the TypeScript's.
    try {
      return holdKey(crypto.createPrivateKey(options));
    } catch {
      if (publicError?.code === "ERR_MISSING_PASSPHRASE") return -1;
      failed(publicError);
      return 0;
    }
  }
  // `createPublicKey` also accepts a private key, answering with its public
  // half; `keys.c`, like node's C++, keeps the private key it parsed.
  try {
    return holdKey(crypto.createPrivateKey(options));
  } catch {
    return holdKey(publicKey);
  }
};

const b64 = (bytes) => bufferFrom(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64url");

function jwkKey(jwk, privateKey) {
  try {
    return holdKey((privateKey ? crypto.createPrivateKey : crypto.createPublicKey)({ key: jwk, format: "jwk" }));
  } catch {
    return 0;
  }
}

globalThis.nts_crypto_key_from_jwk_rsa = (parts, privateKey) => {
  const names = ["n", "e", "d", "p", "q", "dp", "dq", "qi"];
  const jwk = { kty: "RSA" };
  parts.forEach((part, index) => {
    jwk[names[index]] = b64(part);
  });
  return jwkKey(jwk, privateKey);
};

globalThis.nts_crypto_key_curve_known = (curve) => {
  try {
    crypto.createPublicKey({ key: { kty: "EC", crv: curve, x: "", y: "" }, format: "jwk" });
    return true;
  } catch (error) {
    return error?.code !== "ERR_CRYPTO_INVALID_CURVE";
  }
};

globalThis.nts_crypto_key_from_jwk_ec = (curve, x, y, d, privateKey) => {
  const jwk = { kty: "EC", crv: curve, x: b64(x), y: b64(y) };
  if (privateKey) jwk.d = b64(d);
  return jwkKey(jwk, privateKey);
};

function rawKey(options, privateKey) {
  try {
    return holdKey((privateKey ? crypto.createPrivateKey : crypto.createPublicKey)(options));
  } catch (error) {
    return error?.code === "ERR_CRYPTO_INVALID_CURVE" ? -2 : 0;
  }
}

globalThis.nts_crypto_key_from_okp = (curve, raw, privateKey) => {
  if (!["Ed25519", "Ed448", "X25519", "X448"].includes(curve)) return -3;
  const format = privateKey ? "raw-private" : "raw-public";
  return rawKey({ key: raw, format, asymmetricKeyType: curve.toLowerCase() }, privateKey);
};

globalThis.nts_crypto_key_from_post_quantum = (type, raw, form) => {
  const format = ["raw-public", "raw-private", "raw-seed"][form];
  try {
    const options = { key: raw, format, asymmetricKeyType: type };
    return holdKey(form === 0 ? crypto.createPublicKey(options) : crypto.createPrivateKey(options));
  } catch {
    return 0;
  }
};

globalThis.nts_crypto_key_from_raw_ec = (curve, raw, privateKey) => {
  const format = privateKey ? "raw-private" : "raw-public";
  return rawKey({ key: raw, format, asymmetricKeyType: "ec", namedCurve: curve }, privateKey);
};

globalThis.nts_crypto_key_status = () => keyStatus;
globalThis.nts_crypto_curve_names = () => crypto.getCurves();
/** The order of each curve Web Crypto has, the bound on a private scalar, as `openssl ecparam -text` prints it. */
const CURVE_ORDERS = {
  "P-256": 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n,
  "P-384": 0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973n,
  "P-521": 0x01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409n,
};

/**
 * `keys.c`'s `nts_crypto_key_check`, which node does only inside its
 * unpublished `KeyObjectHandle`: OpenSSL's check fails a private scalar
 * outside [1, n-1], which node's parser accepts; a public point off its
 * curve the parser has already refused.
 */
globalThis.nts_crypto_key_check = (handle, privateKey) => {
  const key = keyAt(handle);
  if (key === undefined) return false;
  if (!privateKey || key.asymmetricKeyType !== "ec") return true;
  let jwk;
  try {
    jwk = key.export({ format: "jwk" });
  } catch {
    // A key OpenSSL cannot even write -- its public point at infinity -- fails.
    return false;
  }
  const { crv, d } = jwk;
  const order = CURVE_ORDERS[crv];
  if (order === undefined) return true;
  const scalar = BigInt(`0x${bufferFrom(d, "base64url").toString("hex")}`);
  return scalar > 0n && scalar < order;
};

globalThis.nts_crypto_key_type = (handle) => keyAt(handle)?.asymmetricKeyType ?? "";

globalThis.nts_crypto_key_details = (handle) => {
  const details = keyAt(handle)?.asymmetricKeyDetails ?? {};
  return [details.modulusLength ?? -1, details.divisorLength ?? -1, details.saltLength ?? -1];
};

globalThis.nts_crypto_key_detail_names = (handle) => {
  const details = keyAt(handle)?.asymmetricKeyDetails ?? {};
  return [details.namedCurve ?? "", details.hashAlgorithm ?? "", details.mgf1HashAlgorithm ?? ""];
};

globalThis.nts_crypto_key_public_exponent = (handle) => {
  const exponent = keyAt(handle)?.asymmetricKeyDetails?.publicExponent;
  if (exponent === undefined) return new Uint8Array(0);
  let hex = exponent.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  return new Uint8Array(bufferFrom(hex, "hex"));
};

/** `EVP_PKEY_eq` compares public halves, so this does. */
const publicHalf = (key) => (key.type === "public" ? key : crypto.createPublicKey(key));
globalThis.nts_crypto_key_equals = (a, b) => publicHalf(keyAt(a)).equals(publicHalf(keyAt(b)));

globalThis.nts_crypto_key_export_private = (handle, format, type, cipherId, passphrase) => {
  const options = { format: FORMATS[format], type: ENCODINGS[type] };
  if (cipherId >= 0) {
    options.cipher = cipherNames[cipherId];
    options.passphrase = passphrase;
  }
  try {
    return view(bufferFrom(keyAt(handle).export(options)));
  } catch (error) {
    failed(error);
    return null;
  }
};

globalThis.nts_crypto_key_export_public = (handle, format, type) => {
  try {
    return view(bufferFrom(publicHalf(keyAt(handle)).export({ format: FORMATS[format], type: ENCODINGS[type] })));
  } catch (error) {
    failed(error);
    return null;
  }
};

const JWK_ORDER = { RSA: ["n", "e", "d", "p", "q", "dp", "dq", "qi"], EC: ["x", "y", "d"], OKP: ["x", "d"] };

globalThis.nts_crypto_key_export_jwk = (handle, privateKey) => {
  const key = keyAt(handle);
  try {
    const jwk = (privateKey ? key : publicHalf(key)).export({ format: "jwk" });
    keyStatus = 1;
    // Own members only, decoded through a `Buffer.from` taken at load: this
    // stands in for C, which no program's prototype or global reaches.
    return JWK_ORDER[jwk.kty].filter((name) => Object.hasOwn(jwk, name)).map((name) => new Uint8Array(bufferFrom(jwk[name], "base64url")));
  } catch (error) {
    keyStatus = error?.code === "ERR_CRYPTO_JWK_UNSUPPORTED_CURVE" ? -4 : -3;
    return [];
  }
};

globalThis.nts_crypto_key_export_raw = (handle, privateKey, compressed) => {
  const key = keyAt(handle);
  try {
    const options = privateKey ? { format: "raw-private" } : { format: "raw-public" };
    if (compressed) options.type = "compressed";
    return view((privateKey ? key : publicHalf(key)).export(options));
  } catch {
    return null;
  }
};

globalThis.nts_crypto_key_export_seed = (handle) => {
  try {
    return view(keyAt(handle).export({ format: "raw-seed" }));
  } catch {
    return null;
  }
};

// -- signatures ---------------------------------------------------------------

/**
 * A signing stream's context: node's own `Sign` and `Verify`, fed alike,
 * because which of them finishes is not known until then. `crypto.c`'s
 * context is one digest, finished by either.
 */
globalThis.nts_crypto_sign_init = (id) => {
  try {
    const sign = crypto.createSign(names[id]);
    const verify = crypto.createVerify(names[id]);
    return claim({
      update(data, encoding) {
        sign.update(data, encoding);
        verify.update(data, encoding);
      },
      sign,
      verify,
    });
  } catch (error) {
    failed(error);
    return 0;
  }
};

/** An option given at the ABI as NaN when absent. */
const given = (value) => (Number.isNaN(value) ? undefined : value);

const ONE_SHOT_TYPES = new Set(["ed25519", "ed448", "ml-dsa-44", "ml-dsa-65", "ml-dsa-87"]);

globalThis.nts_crypto_key_is_one_shot = (handle) => ONE_SHOT_TYPES.has(keyAt(handle)?.asymmetricKeyType);

/**
 * The width of a curve's `r` and `s`, asked of node itself: half a P1363
 * signature, from a key made once per curve.
 */
const curveWidths = new Map();

function curveWidth(namedCurve) {
  let width = curveWidths.get(namedCurve);
  if (width === undefined) {
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve });
    width = crypto.sign("sha256", noBytes, { key: privateKey, dsaEncoding: "ieee-p1363" }).length / 2;
    curveWidths.set(namedCurve, width);
  }
  return width;
}

globalThis.nts_crypto_key_dsa_size = (handle) => {
  const key = keyAt(handle);
  const details = key?.asymmetricKeyDetails;
  if (key?.asymmetricKeyType === "dsa") return Math.ceil(details.divisorLength / 8);
  if (key?.asymmetricKeyType === "ec") return curveWidth(details.namedCurve);
  return 0;
};

/** A DER `SEQUENCE { INTEGER, INTEGER }`'s two magnitudes, or null. */
function derIntegers(der) {
  let at = 0;
  const length = () => {
    let size = der[at++];
    if (size < 0x80) return size;
    let count = size & 0x7f;
    size = 0;
    while (count-- > 0) size = size * 256 + der[at++];
    return size;
  };
  if (der[at++] !== 0x30) return null;
  const end = length() + at;
  if (end > der.length) return null;
  const integers = [];
  for (let i = 0; i < 2; i++) {
    if (at >= end || der[at++] !== 0x02) return null;
    const size = length();
    if (size === 0 || at + size > end || der[at] & 0x80) return null;
    let start = at;
    at += size;
    while (start < at - 1 && der[start] === 0) start++;
    integers.push(der.subarray(start, at));
  }
  return integers;
}

globalThis.nts_crypto_signature_to_p1363 = (size, der) => {
  const integers = derIntegers(der);
  if (integers === null) return null;
  const out = new Uint8Array(2 * size);
  for (let i = 0; i < 2; i++) {
    const integer = integers[i][0] === 0 ? integers[i].subarray(1) : integers[i];
    if (integer.length > size) return null;
    out.set(integer, (i + 1) * size - integer.length);
  }
  return out;
};

globalThis.nts_crypto_signature_to_der = (size, p1363) => {
  if (p1363.length !== 2 * size) return null;
  const integer = (bytes) => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    const magnitude = bytes.subarray(start);
    const body = magnitude[0] & 0x80 ? [0, ...magnitude] : [...magnitude];
    return [0x02, ...encodedLength(body.length), ...body];
  };
  const encodedLength = (n) => (n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff]);
  const body = [...integer(p1363.subarray(0, size)), ...integer(p1363.subarray(size))];
  return Uint8Array.from([0x30, ...encodedLength(body.length), ...body]);
};

function signOptions(handle, padding, saltLength) {
  return { key: keyAt(handle), padding: given(padding), saltLength: given(saltLength) };
}

globalThis.nts_crypto_sign_final = (handle, key, padding, saltLength) => {
  const context = contexts.get(handle);
  contexts.delete(handle);
  try {
    return view(context.sign.sign(signOptions(key, padding, saltLength)));
  } catch (error) {
    failed(error);
    return null;
  }
};

globalThis.nts_crypto_verify_final = (handle, key, signature, padding, saltLength) => {
  const context = contexts.get(handle);
  contexts.delete(handle);
  try {
    return context.verify.verify(signOptions(key, padding, saltLength), signature) ? 1 : 0;
  } catch (error) {
    failed(error);
    return -1;
  }
};

let signStatus = 0;

globalThis.nts_crypto_sign_status = () => signStatus;

/** `sig.c`'s status for the step node's words name. */
function signStatusOf(error) {
  if (error?.message === "Context parameter is unsupported") return -3;
  if (error?.message === "EVP_SignInit_ex failed") return -1;
  return -2;
}

/** A `SignJob`'s arguments as `crypto.sign` and `crypto.verify` take them. */
function jobArguments(key, digest, saltLength, padding, context) {
  const options = { ...signOptions(key, padding, saltLength) };
  if (context.length > 0) options.context = context;
  return [digest < 0 ? null : names[digest], options];
}

globalThis.nts_crypto_sign_job_sync = (verify, key, data, digest, saltLength, padding, context, signature) => {
  const [algorithm, options] = jobArguments(key, digest, saltLength, padding, context);
  try {
    signStatus = 0;
    if (verify) return Uint8Array.of(crypto.verify(algorithm, data, options, signature) ? 1 : 0);
    return view(crypto.sign(algorithm, data, options));
  } catch (error) {
    signStatus = signStatusOf(error);
    failed(error);
    return null;
  }
};

globalThis.nts_crypto_sign_job = (verify, key, data, digest, saltLength, padding, context, signature, done) => {
  const [algorithm, options] = jobArguments(key, digest, saltLength, padding, context);
  const deliver = (error, result) => {
    if (error) {
      failed(error);
      done(false, noBytes);
    } else {
      done(true, verify ? Uint8Array.of(result ? 1 : 0) : view(result));
    }
  };
  if (verify) crypto.verify(algorithm, data, options, signature, deliver);
  else crypto.sign(algorithm, data, options, deliver);
};

// -- RSA encryption -----------------------------------------------------------

const RSA_OPERATIONS = [crypto.publicEncrypt, crypto.privateDecrypt, crypto.privateEncrypt, crypto.publicDecrypt];

/**
 * A held key as node's RSA functions should see it. A public key goes as its
 * PEM: node's JavaScript refuses a public `KeyObject` for a private operation,
 * where `rsa.c` -- like node's C++ given a public PEM -- lets OpenSSL refuse it.
 */
function rsaKey(handle) {
  const key = keyAt(handle);
  return key.type === "public" ? key.export({ type: "spki", format: "pem" }) : key;
}

/**
 * Asked of node by decrypting a modulus's worth of zeros with PKCS#1 v1.5:
 * with implicit rejection that answers, without it node refuses the padding,
 * and a key that cannot decrypt fails in OpenSSL.
 */
globalThis.nts_crypto_rsa_implicit_rejection = (handle) => {
  const key = keyAt(handle);
  const size = Math.ceil((key.asymmetricKeyDetails?.modulusLength ?? 8) / 8);
  try {
    crypto.privateDecrypt({ key: rsaKey(handle), padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.alloc(size));
    return 1;
  } catch (error) {
    if (error?.code === "ERR_INVALID_ARG_VALUE") return -1;
    failed(error);
    return 0;
  }
};

globalThis.nts_crypto_public_key_cipher = (operation, handle, data, padding, digest, label) => {
  const options = { key: rsaKey(handle), padding };
  if (digest >= 0) options.oaepHash = names[digest];
  if (label.length > 0) options.oaepLabel = label;
  try {
    return view(RSA_OPERATIONS[operation](options, data));
  } catch (error) {
    failed(error);
    return null;
  }
};

// -- key-pair generation ------------------------------------------------------

/** Configured jobs, as node's own `generateKeyPair` arguments. */
const keygenJobs = new Map();
let nextKeygenJob = 1;

function keygenJob(type, options) {
  const handle = nextKeygenJob++;
  keygenJobs.set(handle, { type, options });
  return handle;
}

globalThis.nts_crypto_keygen_rsa = (pss, bits, exponent, digest, mgf1Digest, saltLength) => {
  const options = { modulusLength: bits, publicExponent: exponent };
  if (pss) {
    if (digest >= 0) options.hashAlgorithm = names[digest];
    if (mgf1Digest >= 0) options.mgf1HashAlgorithm = names[mgf1Digest];
    if (saltLength >= 0) options.saltLength = saltLength;
  }
  return keygenJob(pss ? "rsa-pss" : "rsa", options);
};

globalThis.nts_crypto_keygen_dsa = (bits, divisorBits) =>
  keygenJob("dsa", divisorBits >= 0 ? { modulusLength: bits, divisorLength: divisorBits } : { modulusLength: bits });

globalThis.nts_crypto_keygen_ec = (curve, explicitParameters) =>
  keygenJob("ec", { namedCurve: curve, paramEncoding: explicitParameters ? "explicit" : "named" });

const NID_TYPES = new Set([
  "ed25519", "ed448", "x25519", "x448", "ml-dsa-44", "ml-dsa-65", "ml-dsa-87", "ml-kem-512", "ml-kem-768",
  "ml-kem-1024", "slh-dsa-sha2-128f", "slh-dsa-sha2-128s", "slh-dsa-sha2-192f", "slh-dsa-sha2-192s",
  "slh-dsa-sha2-256f", "slh-dsa-sha2-256s", "slh-dsa-shake-128f", "slh-dsa-shake-128s", "slh-dsa-shake-192f",
  "slh-dsa-shake-192s", "slh-dsa-shake-256f", "slh-dsa-shake-256s",
]);

globalThis.nts_crypto_keygen_nid = (type) => (NID_TYPES.has(type) ? keygenJob(type, undefined) : 0);

const DH_GROUPS = new Set(["modp1", "modp2", "modp5", "modp14", "modp15", "modp16", "modp17", "modp18"]);

globalThis.nts_crypto_keygen_dh_group = (group) =>
  DH_GROUPS.has(group.toLowerCase()) ? keygenJob("dh", { group }) : 0;

globalThis.nts_crypto_keygen_dh_prime = (prime, generator) =>
  keygenJob("dh", { prime: bufferFrom(prime), generator });

globalThis.nts_crypto_keygen_dh_size = (bits, generator) => keygenJob("dh", { primeLength: bits, generator });

globalThis.nts_crypto_keygen_release = (job) => {
  keygenJobs.delete(job);
};

globalThis.nts_crypto_keygen_run = (job) => {
  const { type, options } = keygenJobs.get(job);
  keygenJobs.delete(job);
  try {
    return holdKey(crypto.generateKeyPairSync(type, options).privateKey);
  } catch (error) {
    failed(error);
    return 0;
  }
};

globalThis.nts_crypto_keygen_queue = (job, done) => {
  const { type, options } = keygenJobs.get(job);
  keygenJobs.delete(job);
  crypto.generateKeyPair(type, options, (error, publicKey, privateKey) => {
    if (error) {
      failed(error);
      done(false, 0);
    } else {
      done(true, holdKey(privateKey));
    }
  });
};

// -- key agreement ------------------------------------------------------------

/** `DiffieHellman`, `DiffieHellmanGroup` and `ECDH` objects, node's own, by handle. */
const agreements = [];
let dhStatus = 0;

const holdAgreement = (object) => agreements.push(object);
const agreementAt = (handle) => agreements[handle - 1];

globalThis.nts_crypto_dh_status = () => dhStatus;

/** A construction's status, as `dh.c` reports it, from node's refusal. */
function dhConstructed(make, bits) {
  try {
    return holdAgreement(make());
  } catch (error) {
    failed(error);
    if (error?.code === "ERR_INVALID_ARG_VALUE") return error.message === "Invalid prime" ? -2 : -1;
    return bits !== undefined && bits < 2 ? -4 : -3;
  }
}

globalThis.nts_crypto_dh_new_size = (bits, generator) =>
  dhConstructed(() => crypto.createDiffieHellman(bits, generator), bits);
globalThis.nts_crypto_dh_new_prime = (prime, generator) =>
  dhConstructed(() => crypto.createDiffieHellman(bufferFrom(prime), generator));
globalThis.nts_crypto_dh_new_prime_generator = (prime, generator) =>
  dhConstructed(() => crypto.createDiffieHellman(bufferFrom(prime), bufferFrom(generator)));

globalThis.nts_crypto_dh_group = (name) => {
  try {
    return holdAgreement(crypto.getDiffieHellman(name));
  } catch {
    return 0;
  }
};

globalThis.nts_crypto_dh_check = (handle) => agreementAt(handle).verifyError;

/** A call whose failure `dh.c` reports as NULL. */
function bytesOrNull(call) {
  try {
    return view(call());
  } catch {
    return null;
  }
}

globalThis.nts_crypto_dh_generate_keys = (handle) => bytesOrNull(() => agreementAt(handle).generateKeys());

const DH_PARTS = ["getPrime", "getGenerator", "getPublicKey", "getPrivateKey"];

globalThis.nts_crypto_dh_get = (handle, which) => bytesOrNull(() => agreementAt(handle)[DH_PARTS[which]]());

globalThis.nts_crypto_dh_set_key = (handle, key, privateKey) => {
  try {
    const dh = agreementAt(handle);
    if (privateKey) dh.setPrivateKey(key);
    else dh.setPublicKey(key);
    return true;
  } catch {
    return false;
  }
};

const SECRET_STATUSES = new Map([
  ["Unspecified validation error", -1],
  ["Supplied key is too small", -2],
  ["Supplied key is too large", -3],
  ["Supplied key is invalid", -4],
]);

globalThis.nts_crypto_dh_compute_secret = (handle, key) => {
  try {
    return view(agreementAt(handle).computeSecret(key));
  } catch (error) {
    dhStatus = SECRET_STATUSES.get(error?.message) ?? -5;
    return null;
  }
};

globalThis.nts_crypto_ecdh_new = (curve) => {
  try {
    return holdAgreement(crypto.createECDH(curve));
  } catch (error) {
    return error?.code === "ERR_CRYPTO_INVALID_CURVE" ? -1 : 0;
  }
};

globalThis.nts_crypto_ecdh_generate_keys = (handle) => {
  try {
    agreementAt(handle).generateKeys();
    return true;
  } catch {
    return false;
  }
};

/** `dh.c`'s ECDH statuses, from node's codes. */
function ecdhStatusOf(error) {
  switch (error?.code) {
    case "ERR_CRYPTO_INVALID_CURVE":
      return -1;
    case "ERR_CRYPTO_INVALID_KEYPAIR":
      return -2;
    case "ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY":
      return -3;
    case "ERR_CRYPTO_INVALID_KEYTYPE":
      return -5;
    default:
      return error?.message === "Failed to convert Buffer to EC_POINT" ? -3 : 0;
  }
}

globalThis.nts_crypto_ecdh_compute_secret = (handle, key) => {
  try {
    return view(agreementAt(handle).computeSecret(key));
  } catch (error) {
    dhStatus = ecdhStatusOf(error);
    return null;
  }
};

const POINT_FORMATS = { 2: "compressed", 4: "uncompressed", 6: "hybrid" };

globalThis.nts_crypto_ecdh_get_public_key = (handle, form) =>
  bytesOrNull(() => agreementAt(handle).getPublicKey(undefined, POINT_FORMATS[form]));
globalThis.nts_crypto_ecdh_get_private_key = (handle) => bytesOrNull(() => agreementAt(handle).getPrivateKey());

globalThis.nts_crypto_ecdh_set_private_key = (handle, key) => {
  try {
    agreementAt(handle).setPrivateKey(key);
    return 1;
  } catch (error) {
    return ecdhStatusOf(error);
  }
};

/** Node's own `setPublicKey` warns DEP0031 too; the TypeScript has already. */
globalThis.nts_crypto_ecdh_set_public_key = (handle, key) => {
  const noDeprecation = process.noDeprecation;
  process.noDeprecation = true;
  try {
    agreementAt(handle).setPublicKey(key);
    return 1;
  } catch (error) {
    return ecdhStatusOf(error);
  } finally {
    process.noDeprecation = noDeprecation;
  }
};

globalThis.nts_crypto_ecdh_convert_key = (key, curve, form) => {
  try {
    return view(crypto.ECDH.convertKey(key, curve, undefined, undefined, POINT_FORMATS[form]));
  } catch (error) {
    dhStatus = ecdhStatusOf(error);
    return null;
  }
};

/**
 * The two keys as PEM: node's JavaScript compares two key objects' types
 * before anything is parsed, which the TypeScript has already done, and a
 * mismatch it lets through -- keys given as PEM -- is OpenSSL's to refuse, as
 * it is `dh.c`'s.
 */
function pemOf(handle) {
  const key = keyAt(handle);
  return key.export({ type: key.type === "private" ? "pkcs8" : "spki", format: "pem" });
}

const agreementKeys = (privateKey, publicKey) => ({ privateKey: pemOf(privateKey), publicKey: pemOf(publicKey) });

globalThis.nts_crypto_dh_stateless = (privateKey, publicKey) => {
  try {
    return view(crypto.diffieHellman(agreementKeys(privateKey, publicKey)));
  } catch (error) {
    failed(error);
    return null;
  }
};

globalThis.nts_crypto_dh_stateless_job = (privateKey, publicKey, done) => {
  crypto.diffieHellman(agreementKeys(privateKey, publicKey), (error, secret) => {
    if (error) {
      failed(error);
      done(false, noBytes);
    } else {
      done(true, view(secret));
    }
  });
};

// -- primes -------------------------------------------------------------------

const toBigInt = (bytes) => (bytes.length === 0 ? 0n : BigInt(`0x${bufferFrom(bytes).toString("hex")}`));

globalThis.nts_crypto_prime_options = (bits, add, hasAdd, rem, hasRem) => {
  if (!hasAdd) return 0;
  const a = toBigInt(add);
  if (a.toString(2).length > bits && a !== 0n) return -1;
  if (hasRem && a <= toBigInt(rem)) return -2;
  return 0;
};

function primeOptions(safe, add, hasAdd, rem, hasRem) {
  const options = { safe };
  if (hasAdd) options.add = bufferFrom(add);
  if (hasRem) options.rem = bufferFrom(rem);
  return options;
}

globalThis.nts_crypto_prime_generate = (bits, safe, add, hasAdd, rem, hasRem) =>
  sync(() => crypto.generatePrimeSync(bits, primeOptions(safe, add, hasAdd, rem, hasRem)));

globalThis.nts_crypto_prime_generate_job = (bits, safe, add, hasAdd, rem, hasRem, done) =>
  job((callback) => crypto.generatePrime(bits, primeOptions(safe, add, hasAdd, rem, hasRem), callback), done);

/**
 * OpenSSL's own bound, `bn_expand`'s `INT_MAX / (4 * BN_BITS2)` words of eight
 * bytes. A candidate past it is handed to node, whose job refuses it while
 * configuring, before any test runs, and so says why in OpenSSL's words.
 */
const MAX_BIGNUM_BYTES = Math.floor(2147483647 / (4 * 64)) * 8;

globalThis.nts_crypto_prime_candidate_ok = (candidate) => {
  if (candidate.length <= MAX_BIGNUM_BYTES) return true;
  try {
    crypto.checkPrimeSync(candidate);
    return true;
  } catch (error) {
    failed(error);
    return false;
  }
};

globalThis.nts_crypto_prime_check = (candidate, checks) => {
  try {
    return crypto.checkPrimeSync(candidate, { checks }) ? 1 : 0;
  } catch (error) {
    failed(error);
    return -1;
  }
};

globalThis.nts_crypto_prime_check_job = (candidate, checks, done) => {
  crypto.checkPrime(candidate, { checks }, (error, result) => {
    if (error) {
      failed(error);
      done(false, noBytes);
    } else {
      done(true, Uint8Array.of(result ? 1 : 0));
    }
  });
};

// -- argon2 -------------------------------------------------------------------

const ARGON2_TYPES = ["argon2d", "argon2i", "argon2id"];

globalThis.nts_crypto_argon2_supported = () => typeof crypto.argon2Sync === "function";

function argon2Parameters(pass, salt, lanes, keylen, memcost, iter, secret, ad) {
  const parameters = { message: pass, nonce: salt, parallelism: lanes, tagLength: keylen, memory: memcost, passes: iter };
  if (secret.length > 0) parameters.secret = secret;
  if (ad.length > 0) parameters.associatedData = ad;
  return parameters;
}

globalThis.nts_crypto_argon2 = (type, pass, salt, lanes, keylen, memcost, iter, secret, ad) =>
  sync(() => crypto.argon2Sync(ARGON2_TYPES[type], argon2Parameters(pass, salt, lanes, keylen, memcost, iter, secret, ad)));

globalThis.nts_crypto_argon2_job = (type, pass, salt, lanes, keylen, memcost, iter, secret, ad, done) =>
  job(
    (callback) =>
      crypto.argon2(ARGON2_TYPES[type], argon2Parameters(pass, salt, lanes, keylen, memcost, iter, secret, ad), callback),
    done,
  );

// -- key encapsulation --------------------------------------------------------

globalThis.nts_crypto_kem_encapsulate = (handle) => {
  try {
    const { sharedKey, ciphertext } = crypto.encapsulate(keyAt(handle));
    return [view(sharedKey), view(ciphertext)];
  } catch {
    return [];
  }
};

globalThis.nts_crypto_kem_decapsulate = (handle, ciphertext) => bytesOrNull(() => crypto.decapsulate(keyAt(handle), ciphertext));

globalThis.nts_crypto_kem_encapsulate_job = (handle, done) => {
  crypto.encapsulate(keyAt(handle), (error, result) => {
    if (error) done(false, noBytes, noBytes);
    else done(true, view(result.sharedKey), view(result.ciphertext));
  });
};

globalThis.nts_crypto_kem_decapsulate_job = (handle, ciphertext, done) => {
  crypto.decapsulate(keyAt(handle), ciphertext, (error, sharedKey) => {
    if (error) done(false, noBytes);
    else done(true, view(sharedKey));
  });
};

// -- SPKAC --------------------------------------------------------------------

globalThis.nts_crypto_spkac_verify = (input) => crypto.Certificate.verifySpkac(input);

/** Node answers `""` where `spkac.c` answers NULL. */
const spkacOrNull = (value) => (typeof value === "string" ? null : view(value));

globalThis.nts_crypto_spkac_public_key = (input) => spkacOrNull(crypto.Certificate.exportPublicKey(input));
globalThis.nts_crypto_spkac_challenge = (input) => spkacOrNull(crypto.Certificate.exportChallenge(input));

// -- X509Certificate ----------------------------------------------------------

const certificates = [];
const certificateAt = (handle) => certificates[handle - 1];
const orNull = (value) => value ?? null;

globalThis.nts_crypto_x509_parse = (input) => {
  try {
    return certificates.push(new crypto.X509Certificate(input));
  } catch (error) {
    failed(error);
    return 0;
  }
};

globalThis.nts_crypto_x509_name = (handle, issuer) => {
  const cert = certificateAt(handle);
  return orNull(issuer ? cert.issuer : cert.subject);
};
globalThis.nts_crypto_x509_subject_alt_name = (handle) => orNull(certificateAt(handle).subjectAltName);
globalThis.nts_crypto_x509_info_access = (handle) => orNull(certificateAt(handle).infoAccess);
globalThis.nts_crypto_x509_valid_text = (handle, to) => {
  const cert = certificateAt(handle);
  return orNull(to ? cert.validTo : cert.validFrom);
};
globalThis.nts_crypto_x509_valid_time = (handle, to) => {
  const cert = certificateAt(handle);
  return (to ? cert.validToDate : cert.validFromDate).getTime() / 1000;
};
globalThis.nts_crypto_x509_signature_algorithm = (handle) => orNull(certificateAt(handle).signatureAlgorithm);
globalThis.nts_crypto_x509_signature_algorithm_oid = (handle) => orNull(certificateAt(handle).signatureAlgorithmOid);

/** Indexed by `FingerprintDigest`. */
const FINGERPRINTS = ["fingerprint", "fingerprint256", "fingerprint512"];

globalThis.nts_crypto_x509_fingerprint = (handle, digest) => orNull(certificateAt(handle)[FINGERPRINTS[digest]]);
globalThis.nts_crypto_x509_key_usage = (handle) => orNull(certificateAt(handle).keyUsage);
globalThis.nts_crypto_x509_serial_number = (handle) => orNull(certificateAt(handle).serialNumber);
globalThis.nts_crypto_x509_pem = (handle) => orNull(certificateAt(handle).toString());
globalThis.nts_crypto_x509_raw = (handle) => view(certificateAt(handle).raw);

globalThis.nts_crypto_x509_public_key = (handle) => {
  try {
    return holdKey(certificateAt(handle).publicKey);
  } catch (error) {
    failed(error);
    return 0;
  }
};

globalThis.nts_crypto_x509_check_ca = (handle) => certificateAt(handle).ca;
globalThis.nts_crypto_x509_check_issued = (handle, issuer) => certificateAt(handle).checkIssued(certificateAt(issuer));
globalThis.nts_crypto_x509_check_private_key = (handle, key) => certificateAt(handle).checkPrivateKey(keyAt(key));
globalThis.nts_crypto_x509_verify = (handle, key) => certificateAt(handle).verify(publicHalf(keyAt(key)));

/** OpenSSL's `X509_CHECK_FLAG_*` back into the options node's methods take. */
function checkOptions(flags) {
  return {
    subject: flags & 0x1 ? "always" : flags & 0x20 ? "never" : "default",
    wildcards: (flags & 0x2) === 0,
    partialWildcards: (flags & 0x4) === 0,
    multiLabelWildcards: (flags & 0x8) !== 0,
    singleLabelSubdomains: (flags & 0x10) !== 0,
  };
}

/** Indexed by `SubjectKind`. */
const CHECKS = ["checkHost", "checkEmail", "checkIP"];

/** `CheckMatch`, from what node's method answered or threw. */
globalThis.nts_crypto_x509_check = (handle, kind, subject, flags) => {
  try {
    return certificateAt(handle)[CHECKS[kind]](subject, checkOptions(flags)) === undefined ? 0 : 1;
  } catch (error) {
    return error?.code === "ERR_INVALID_ARG_VALUE" ? -2 : -1;
  }
};

globalThis.nts_crypto_x509_matched_host = (handle, subject, flags) =>
  orNull(certificateAt(handle).checkHost(subject, checkOptions(flags)));

/** The legacy object's fields, which is where node publishes what these ask. */
const legacyOf = (handle) => certificateAt(handle).toLegacyObject();

globalThis.nts_crypto_x509_name_entries = (handle, issuer) => {
  const legacy = legacyOf(handle);
  const entries = [];
  for (const [key, value] of Object.entries(issuer ? legacy.issuer : legacy.subject)) {
    for (const item of Array.isArray(value) ? value : [value]) entries.push(key, item);
  }
  return entries;
};

/** `LegacyKeyFamily`: RSA publishes a modulus, EC a point and no modulus. */
globalThis.nts_crypto_x509_legacy_family = (handle) => {
  const legacy = legacyOf(handle);
  return legacy.modulus !== undefined ? 1 : legacy.pubkey !== undefined ? 2 : 0;
};
globalThis.nts_crypto_x509_rsa_number = (handle, exponent) => {
  const legacy = legacyOf(handle);
  return orNull(exponent ? legacy.exponent : legacy.modulus);
};
globalThis.nts_crypto_x509_legacy_public_key = (handle) => {
  const pubkey = legacyOf(handle).pubkey;
  return pubkey === undefined ? null : view(pubkey);
};
globalThis.nts_crypto_x509_legacy_bits = (handle) => legacyOf(handle).bits ?? -1;
globalThis.nts_crypto_x509_legacy_curve = (handle, nist) => {
  const legacy = legacyOf(handle);
  return orNull(nist ? legacy.nistCurve : legacy.asn1Curve);
};

// -- Web Crypto's AES -----------------------------------------------------------

/** `aes.c`'s modes, as node's Web Crypto names them. */
const AES_NAMES = ["AES-CBC", "AES-CTR", "AES-GCM", "AES-KW", "AES-OCB", "ChaCha20-Poly1305"];
/** Each mode's IV length, as `EVP_CIPHER_get_iv_length` answers; KW's is its default IV's. */
const AES_IV_LENGTHS = [16, 16, 12, 8, 12, 12];

/** `aes.c`'s `nts_crypto_aes_config`, whose answer is fixed by its arguments. */
globalThis.nts_crypto_aes_config = (mode, keyBytes, ivBytes, length) => {
  if (![16, 24, 32].includes(keyBytes) || AES_NAMES[mode] === undefined) return -1;
  if (mode === 5) return keyBytes !== 32 ? -1 : ivBytes !== 12 ? -2 : 0;
  const ivLength = mode === 3 ? 8 : ivBytes;
  if (mode === 1 && (ivLength !== 16 || length === 0 || length > 128)) return -3;
  if ((mode === 2 || mode === 4) && length > 128) return -4;
  if (mode === 4) return ivLength === 0 || ivLength > 15 ? -2 : 0;
  return ivLength < AES_IV_LENGTHS[mode] ? -2 : 0;
};

/** `aes.c`'s work through node's ciphers: CBC, CTR, GCM, OCB, and KW under its default IV. */
function aesCipher(mode, encrypt, key, data, iv, length, additional) {
  const bits = key.byteLength * 8;
  const run = (name, cipherIv, options) =>
    encrypt ? crypto.createCipheriv(name, key, cipherIv, options) : crypto.createDecipheriv(name, key, cipherIv, options);
  if (mode === 3) {
    const cipher = run(`id-aes${bits}-wrap`, Buffer.alloc(8, 0xa6));
    return Buffer.concat([cipher.update(data), cipher.final()]);
  }
  if (mode === 0) {
    const cipher = run(`aes-${bits}-cbc`, iv);
    return Buffer.concat([cipher.update(data), cipher.final()]);
  }
  if (mode === 1) return aesCtr(bits, encrypt, key, data, iv, length);
  // An AEAD: the tag follows the ciphertext.
  const name = mode === 5 ? "chacha20-poly1305" : `aes-${bits}-${mode === 2 ? "gcm" : "ocb"}`;
  const cipher = run(name, iv, { authTagLength: length });
  if (additional.byteLength > 0) cipher.setAAD(additional);
  if (encrypt) return Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
  if (data.byteLength < length) throw new Error("Cipher job failed");
  cipher.setAuthTag(data.subarray(data.byteLength - length));
  return Buffer.concat([cipher.update(data.subarray(0, data.byteLength - length)), cipher.final()]);
}

/** `aes.c`'s CTR: the counter is the block's low `length` bits, wrapping to zero within them. */
function aesCtr(bits, encrypt, key, data, counter, length) {
  const name = `aes-${bits}-ctr`;
  const blocks = BigInt(Math.ceil(data.byteLength / 16));
  const counters = 1n << BigInt(length);
  if (blocks > counters) throw new Error("Cipher job failed");
  const current = BigInt(`0x${bufferFrom(counter).toString("hex")}`) & (counters - 1n);
  const runFrom = (block, input) => {
    const cipher = encrypt ? crypto.createCipheriv(name, key, block) : crypto.createDecipheriv(name, key, block);
    return Buffer.concat([cipher.update(input), cipher.final()]);
  };
  const untilReset = counters - current;
  if (untilReset >= blocks) return runFrom(counter, data);
  const first = Number(untilReset) * 16;
  const zeroed = bufferFrom(counter);
  const lengthBytes = Math.floor(length / 8);
  zeroed.fill(0, 16 - lengthBytes);
  if (length % 8 !== 0) zeroed[16 - lengthBytes - 1] &= 0xff << length % 8;
  return Buffer.concat([runFrom(counter, data.subarray(0, first)), runFrom(zeroed, data.subarray(first))]);
}

/**
 * Computed at once, as `aes.c` copies its inputs when called, and delivered
 * on a later turn of the loop. No promise: a test may have replaced
 * `Promise.prototype.then` and poisoned `constructor`, and node's own
 * implementation of this never touches either.
 */
globalThis.nts_crypto_aes_job = (mode, encrypt, key, data, iv, length, additional, done) => {
  let bytes = null;
  try {
    bytes = view(aesCipher(mode, encrypt, key, data, iv, length, additional));
  } catch (error) {
    failed(error);
  }
  setImmediate(() => done(bytes !== null, bytes ?? noBytes));
};

// -- Web Crypto's RSA-OAEP ------------------------------------------------------

globalThis.nts_crypto_rsa_oaep_job = (encrypt, handle, digest, label, data, done) => {
  let bytes = null;
  try {
    const options = { key: keyAt(handle), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: names[digest] };
    if (label.byteLength > 0) options.oaepLabel = label;
    bytes = view(encrypt ? crypto.publicEncrypt(options, data) : crypto.privateDecrypt(options, data));
  } catch (error) {
    failed(error);
  }
  setImmediate(() => done(bytes !== null, bytes ?? noBytes));
};
