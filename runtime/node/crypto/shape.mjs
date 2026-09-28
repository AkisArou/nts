// The object node's tests see as `require('crypto')`.
//
// The implementation is TypeScript, and what node's tests can see that is not
// TypeScript is metadata: the order of the exports, which of them are
// accessors (`getRandomValues`, and the deprecated `randomBytes` aliases,
// which are also not enumerable), `constants` fixed in place, the
// `toStringTag` `KeyObject` carries, and three arities that a TypeScript
// signature cannot spell -- a default parameter ends node's count
// (`randomFillSync(buf, offset = 0, size)` is 1, `scryptSync` is 3), and
// `timingSafeEqual` is a C++ function, which has none.
//
// Applied once per module object: the prototypes are shared by every shape of
// the same exports.

import { deprecate } from "node:util";

const shaped = new WeakSet();

/** Node's `--pending-deprecation`, read from the process this shape serves. */
function pendingDeprecation() {
  const flags = process.execArgv;
  const pending = flags.includes("--pending-deprecation") || process.env.NODE_PENDING_DEPRECATION === "1";
  return pending && !flags.includes("--no-deprecation");
}

function arity(fn, length) {
  Object.defineProperty(fn, "length", { configurable: true, enumerable: false, writable: false, value: length });
}

/**
 * A class as node's function-constructor: callable without `new`, sharing the
 * class's prototype so that every instance is an instance of it, and with its
 * arity. Node's `Hash` is `if (!new.target) return new Hash(...)`.
 */
function callable(Class) {
  function Constructor(...args) {
    return new Class(...args);
  }
  Constructor.prototype = Class.prototype;
  // One function in node, so an instance's `constructor` is the exported one.
  Object.defineProperty(Class.prototype, "constructor", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: Constructor,
  });
  arity(Constructor, Class.length);
  return Constructor;
}

function applyDescriptors(exports) {
  arity(exports.randomFillSync, 1);
  arity(exports.scryptSync, 3);
  arity(exports.scrypt, 4);
  arity(exports.timingSafeEqual, 0);
  // Node's `customPromisifyArgs` on `generateKeyPair`: `util.promisify`
  // resolves `{ publicKey, privateKey }` rather than the first result alone.
  // The symbol is internal to node, so the link is made the public way, as
  // `child_process` makes `exec`'s.
  if (typeof exports.generateKeyPair === "function") {
    const generateKeyPair = exports.generateKeyPair;
    const promisified = function (...args) {
      return new Promise((resolve, reject) => {
        generateKeyPair(...args, (error, publicKey, privateKey) => {
          if (error) reject(error);
          else resolve({ publicKey, privateKey });
        });
      });
    };
    Object.defineProperty(promisified, "name", { value: "generateKeyPair", configurable: true });
    Object.defineProperty(generateKeyPair, Symbol.for("nodejs.util.promisify.custom"), {
      enumerable: false,
      writable: false,
      configurable: true,
      value: promisified,
    });
  }
  if (exports.CryptoKey !== undefined) webCryptoDescriptors(exports);
  Object.defineProperty(exports.KeyObject.prototype, Symbol.toStringTag, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: "KeyObject",
  });
}

/**
 * Web Crypto's interfaces as node defines them: every member of a prototype
 * enumerable, each with its `toStringTag`, and `SubtleCrypto.supports`
 * enumerable too -- descriptors a TypeScript class does not produce.
 */
function webCryptoDescriptors(exports) {
  const tag = (prototype, value) =>
    Object.defineProperty(prototype, Symbol.toStringTag, { configurable: true, enumerable: false, writable: false, value });
  const enumerable = (target, names) => {
    for (const name of names) Object.defineProperty(target, name, { enumerable: true });
  };
  enumerable(exports.CryptoKey.prototype, ["type", "extractable", "algorithm", "usages"]);
  tag(exports.CryptoKey.prototype, "CryptoKey");
  enumerable(exports.Crypto.prototype, ["subtle", "getRandomValues", "randomUUID"]);
  tag(exports.Crypto.prototype, "Crypto");
  enumerable(exports.SubtleCrypto.prototype, [
    "encrypt",
    "decrypt",
    "sign",
    "verify",
    "digest",
    "generateKey",
    "deriveKey",
    "deriveBits",
    "importKey",
    "exportKey",
    "wrapKey",
    "unwrapKey",
    "getPublicKey",
    "encapsulateBits",
    "encapsulateKey",
    "decapsulateBits",
    "decapsulateKey",
  ]);
  tag(exports.SubtleCrypto.prototype, "SubtleCrypto");
  enumerable(exports.SubtleCrypto, ["supports"]);
}

/** Node's order, for the names this module publishes. */
const ORDER = [
  "argon2",
  "argon2Sync",
  "checkPrime",
  "checkPrimeSync",
  "createCipheriv",
  "createDecipheriv",
  "createDiffieHellman",
  "createDiffieHellmanGroup",
  "createECDH",
  "createHash",
  "createHmac",
  "createPrivateKey",
  "createPublicKey",
  "createSecretKey",
  "createSign",
  "createVerify",
  "diffieHellman",
  "generatePrime",
  "generatePrimeSync",
  "getCiphers",
  "getCipherInfo",
  "getCurves",
  "getDiffieHellman",
  "getHashes",
  "hkdf",
  "hkdfSync",
  "pbkdf2",
  "pbkdf2Sync",
  "generateKeyPair",
  "generateKeyPairSync",
  "generateKey",
  "generateKeySync",
  "privateDecrypt",
  "privateEncrypt",
  "publicDecrypt",
  "publicEncrypt",
  "randomBytes",
  "randomFill",
  "randomFillSync",
  "randomInt",
  "randomUUID",
  "randomUUIDv7",
  "scrypt",
  "scryptSync",
  "sign",
  "timingSafeEqual",
  "getFips",
  "setFips",
  "verify",
  "hash",
  "encapsulate",
  "decapsulate",
  "Certificate",
  "Cipheriv",
  "Decipheriv",
  "DiffieHellman",
  "DiffieHellmanGroup",
  "ECDH",
  "Hash",
  "Hmac",
  "KeyObject",
  "Sign",
  "Verify",
  "X509Certificate",
  "secureHeapUsed",
];

/**
 * Node's constructors are functions that construct themselves without `new`;
 * `Hash` and `Hmac` also warn that they are deprecated. Made once per export
 * table, because each class's prototype names its wrapper as `constructor`.
 */
const constructorTables = new WeakMap();

function constructorsOf(exports) {
  let constructors = constructorTables.get(exports);
  if (constructors === undefined) {
    constructors = {
      Certificate: Object.assign(callable(exports.Certificate), {
        exportChallenge: exports.Certificate.exportChallenge,
        exportPublicKey: exports.Certificate.exportPublicKey,
        verifySpkac: exports.Certificate.verifySpkac,
      }),
      Cipheriv: callable(exports.Cipheriv),
      Decipheriv: callable(exports.Decipheriv),
      Sign: callable(exports.Sign),
      DiffieHellman: callable(exports.DiffieHellman),
      DiffieHellmanGroup: callable(exports.DiffieHellmanGroup),
      ECDH: Object.assign(callable(exports.ECDH), { convertKey: exports.ECDH.convertKey }),
      Verify: callable(exports.Verify),
      Hash: deprecate(callable(exports.Hash), "crypto.Hash constructor is deprecated.", "DEP0179"),
      Hmac: deprecate(callable(exports.Hmac), "crypto.Hmac constructor is deprecated.", "DEP0181"),
    };
    constructorTables.set(exports, constructors);
  }
  return constructors;
}

export function shape(exports) {
  // A compiled module may publish none of this yet; guarded so each test fails
  // saying which export it wanted rather than "the module did not load".
  if (exports.createHash === undefined || exports.KeyObject === undefined) return {};
  if (!shaped.has(exports)) {
    shaped.add(exports);
    applyDescriptors(exports);
  }
  const constructors = constructorsOf(exports);
  const module = {};
  for (const name of ORDER) {
    const value = constructors[name] ?? exports[name];
    if (value !== undefined) module[name] = value;
  }
  Object.defineProperty(module, "constants", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: exports.constants,
  });
  // Web Crypto: node's accessors, one global object behind both.
  const webcrypto = exports.webcrypto;
  if (webcrypto !== undefined) {
    Object.defineProperty(module, "webcrypto", { configurable: false, enumerable: true, get: () => webcrypto, set: undefined });
    Object.defineProperty(module, "subtle", {
      configurable: false,
      enumerable: true,
      get: () => webcrypto.subtle,
      set: undefined,
    });
  }
  const getRandomValues = exports.getRandomValues;
  Object.defineProperty(module, "getRandomValues", {
    configurable: false,
    enumerable: true,
    get: () => getRandomValues,
    set: undefined,
  });
  // DEP0115's aliases: accessors that become ordinary properties once read or
  // written, as node's `getRandomBytesAlias` makes them, and that warn under
  // `--pending-deprecation`.
  for (const key of ["prng", "pseudoRandomBytes", "rng"]) {
    Object.defineProperty(module, key, {
      configurable: true,
      enumerable: false,
      get() {
        const value = pendingDeprecation()
          ? deprecate(exports.randomBytes, `crypto.${key} is deprecated.`, "DEP0115")
          : exports.randomBytes;
        Object.defineProperty(this, key, { configurable: true, enumerable: false, writable: true, value });
        return value;
      },
      set(value) {
        Object.defineProperty(this, key, { configurable: true, enumerable: true, writable: true, value });
      },
    });
  }
  return module;
}

/**
 * Node's internals that its tests ask for with `--expose-internals`: the
 * X.509 brand, and Web Crypto's converters and registry.
 */
export function internals(exports) {
  return {
    "internal/crypto/x509": {
      X509Certificate: exports.X509Certificate,
      isX509Certificate: exports.isX509Certificate,
    },
    "internal/crypto/webidl": {
      converters: exports.webCryptoConverters?.(),
      requiredArguments: exports.webCryptoRequiredArguments,
    },
    "internal/crypto/keys": {
      getCryptoKeyHandle: exports.getCryptoKeyHandle,
    },
    "internal/crypto/util": {
      bigIntArrayToUnsignedBigInt: exports.bigIntArrayToUnsignedBigInt,
      bigIntArrayToUnsignedInt: exports.bigIntArrayToUnsignedInt,
      kSupportedAlgorithms: exports.supportedAlgorithms?.(),
      normalizeAlgorithm: exports.normalizeAlgorithm,
      validateKeyOps: exports.validateKeyOps,
    },
  };
}

/**
 * Node's Web Crypto globals: `crypto`, a replaceable accessor, and the three
 * interfaces. A sabotaged run installs an empty `crypto` rather than leaving
 * node's, which every Web Crypto file would otherwise measure instead.
 */
export function installGlobals(underTest, rawExports) {
  let crypto = underTest.webcrypto ?? {};
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    enumerable: true,
    get: () => crypto,
    set: (value) => {
      crypto = value;
    },
  });
  for (const name of ["Crypto", "CryptoKey", "SubtleCrypto"]) {
    Object.defineProperty(globalThis, name, { configurable: true, enumerable: false, writable: true, value: rawExports[name] });
  }
}
