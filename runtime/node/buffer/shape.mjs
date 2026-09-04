// The object node's tests see as `require('buffer')`.
//
// Node's module exports `Buffer` alongside `kMaxLength`, `constants`, `atob`,
// `btoa` and the rest; the class itself is one property, not the module.
import { Blob as HostBlob } from "node:buffer";

export function shape(exports) {
  const mod = { ...exports };
  delete mod.default;
  installIdentityAliases(exports.Buffer);
  mod.Buffer = callableBuffer(exports.Buffer);
  // Blob is a Web-platform value used as an input fixture by other module
  // suites. Buffer owns no Blob algorithm; Node supplies the platform class.
  mod.Blob = HostBlob;
  return mod;
}

/**
 * Node exposes both `UInt` and `Uint` spellings as the same function object.
 * The compiled class implements both statically; this Node-only shape makes
 * their observable JavaScript identity match without adding another call to
 * either implementation.
 */
function installIdentityAliases(Buffer) {
  const aliases = [
    ["readUint8", "readUInt8"],
    ["readUint16BE", "readUInt16BE"],
    ["readUint16LE", "readUInt16LE"],
    ["readUint32BE", "readUInt32BE"],
    ["readUint32LE", "readUInt32LE"],
    ["readUintBE", "readUIntBE"],
    ["readUintLE", "readUIntLE"],
    ["readBigUint64BE", "readBigUInt64BE"],
    ["readBigUint64LE", "readBigUInt64LE"],
    ["writeUint8", "writeUInt8"],
    ["writeUint16BE", "writeUInt16BE"],
    ["writeUint16LE", "writeUInt16LE"],
    ["writeUint32BE", "writeUInt32BE"],
    ["writeUint32LE", "writeUInt32LE"],
    ["writeUintBE", "writeUIntBE"],
    ["writeUintLE", "writeUIntLE"],
    ["writeBigUint64BE", "writeBigUInt64BE"],
    ["writeBigUint64LE", "writeBigUInt64LE"],
  ];
  for (const [alias, canonical] of aliases) {
    Buffer.prototype[alias] = Buffer.prototype[canonical];
  }
  Buffer.prototype.toLocaleString = Buffer.prototype.toString;
  Buffer.prototype[Symbol.for("nodejs.util.inspect.custom")] = Buffer.prototype.inspect;
}

/**
 * `Buffer` is callable with and without `new`, and both are deprecated.
 *
 * `Buffer(10)` and `new Buffer(10)` both mean `Buffer.alloc(10)`, and
 * `Buffer("ab")` means `Buffer.from("ab")`. A class constructor cannot be
 * called without `new`, so the export is a function that dispatches -- the
 * same shape `Console` and `Assert` need, and for the same reason.
 *
 * It lives here rather than in the TypeScript because a module cannot export a
 * callable class, and because the deprecated form is a compatibility surface
 * rather than something a compiled program should carry.
 */
function callableBuffer(Buffer) {
  const legacy = function Buffer_(value, encodingOrOffset, length) {
    if (typeof value === "number") {
      if (typeof encodingOrOffset === "string") {
        const error = new TypeError(
          `The "string" argument must be of type string. Received type number (${value})`,
        );
        error.code = "ERR_INVALID_ARG_TYPE";
        throw error;
      }
      return Buffer.alloc(value);
    }
    return Buffer.from(value, encodingOrOffset, length);
  };
  Object.setPrototypeOf(legacy, Buffer);
  legacy.prototype = Buffer.prototype;
  Object.defineProperty(legacy, "name", { value: "Buffer" });
  return legacy;
}

// `Buffer` is installed as a global, and the pass count argues against it while
// the hollow count argues for it -- which is the whole reason the hollow count
// exists.
//
// Substituting it does change what *node's own modules* do: `fs`,
// `util.inspect` and the test harness all reach for the global and none of
// them accepts ours, so a number of files fail that would otherwise pass.
// Removing it takes this module from 33 passing to 54.
//
// Those 54 include **46 hollow**. Without the global, a test writing
// `Buffer.alloc(...)` unqualified gets node's Buffer and never touches ours at
// all -- it passes, and it measures nothing. Real coverage is 32 with the
// global and 8 without it. The higher number is the worse measurement by a
// factor of four.
//
// Measured in both directions, and the sabotage run is the only thing that
// could tell them apart. An earlier version of this comment said there was no
// `installGlobals` here, directly above one; going by that comment and the
// pass count alone, removing it looked like a twenty-one file win.

export function installGlobals(underTest) {
  globalThis.Buffer = underTest.Buffer;
}
