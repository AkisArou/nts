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
  arity(Constructor, Class.length);
  return Constructor;
}

function applyDescriptors(exports) {
  arity(exports.randomFillSync, 1);
  arity(exports.scryptSync, 3);
  arity(exports.scrypt, 4);
  arity(exports.timingSafeEqual, 0);
  Object.defineProperty(exports.KeyObject.prototype, Symbol.toStringTag, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: "KeyObject",
  });
}

/** Node's order, for the names this module publishes. */
const ORDER = [
  "createCipheriv",
  "createDecipheriv",
  "createHash",
  "createHmac",
  "createPrivateKey",
  "createPublicKey",
  "createSecretKey",
  "createSign",
  "createVerify",
  "getCiphers",
  "getCipherInfo",
  "getCurves",
  "getHashes",
  "hkdf",
  "hkdfSync",
  "pbkdf2",
  "pbkdf2Sync",
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
  "Cipheriv",
  "Decipheriv",
  "Hash",
  "Hmac",
  "KeyObject",
  "Sign",
  "Verify",
  "secureHeapUsed",
];

export function shape(exports) {
  // A compiled module may publish none of this yet; guarded so each test fails
  // saying which export it wanted rather than "the module did not load".
  if (exports.createHash === undefined || exports.KeyObject === undefined) return {};
  if (!shaped.has(exports)) {
    shaped.add(exports);
    applyDescriptors(exports);
  }
  // Node's constructors are functions that construct themselves without
  // `new`; `Hash` and `Hmac` also warn that they are deprecated.
  const constructors = {
    Cipheriv: callable(exports.Cipheriv),
    Decipheriv: callable(exports.Decipheriv),
    Sign: callable(exports.Sign),
    Verify: callable(exports.Verify),
    Hash: deprecate(callable(exports.Hash), "crypto.Hash constructor is deprecated.", "DEP0179"),
    Hmac: deprecate(callable(exports.Hmac), "crypto.Hmac constructor is deprecated.", "DEP0181"),
  };
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
