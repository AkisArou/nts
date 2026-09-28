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

function failed(error) {
  record = fromOpenSSL(error);
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
  try {
    return holdKey(crypto.createPublicKey(options));
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
};

const b64 = (bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64url");

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

globalThis.nts_crypto_key_from_raw_ec = (curve, raw, privateKey) => {
  const format = privateKey ? "raw-private" : "raw-public";
  return rawKey({ key: raw, format, asymmetricKeyType: "ec", namedCurve: curve }, privateKey);
};

globalThis.nts_crypto_key_status = () => keyStatus;
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
  return new Uint8Array(Buffer.from(hex, "hex"));
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
    return view(Buffer.from(keyAt(handle).export(options)));
  } catch (error) {
    failed(error);
    return null;
  }
};

globalThis.nts_crypto_key_export_public = (handle, format, type) => {
  try {
    return view(Buffer.from(publicHalf(keyAt(handle)).export({ format: FORMATS[format], type: ENCODINGS[type] })));
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
    return JWK_ORDER[jwk.kty].filter((name) => jwk[name] !== undefined).map((name) => new Uint8Array(Buffer.from(jwk[name], "base64url")));
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
