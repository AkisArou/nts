// The object node's tests see as `require('readline')`.
//
// Node exports eight names. Ours exports the same eight plus the types, which
// erase, and `Completer`/`InterfaceOptions` do not exist at run time -- so the
// shaping here is mostly about being explicit rather than about hiding
// anything, and it stays explicit so that a name added later has to be added
// here too.

import * as utils from "./src/utils.ts";
import * as callbacks from "../internal/readline-callbacks.ts";
import { getStringWidth } from "../util/src/width.ts";
import { inspect } from "../util/src/inspect.ts";
import { stripVTControlCharacters } from "../util/src/main.ts";

export function shape(exports) {
  installQuestionPromisifier(exports.Interface, exports.kQuestionPromise);
  return {
    Interface: callableInterface(exports.Interface),
    clearLine: exports.clearLine,
    clearScreenDown: exports.clearScreenDown,
    createInterface: exports.createInterface,
    cursorTo: exports.cursorTo,
    emitKeypressEvents: exports.emitKeypressEvents,
    moveCursor: exports.moveCursor,
    promises: exports.promises,
  };
}

/** The public subpath is the same namespace exposed by `readline.promises`. */
export function subpaths(exports) {
  return { "readline/promises": exports.promises };
}

/** Put Node's function-object hook at the untyped CommonJS boundary only. */
function installQuestionPromisifier(InterfaceClass, questionPromise) {
  const custom = Symbol.for("nodejs.util.promisify.custom");
  InterfaceClass.prototype.question[custom] = function question(query, options) {
    return this[questionPromise](query, options);
  };
}

/**
 * `readline.Interface` predates classes and remains callable without `new`.
 * The implementation stays a typed class; this boundary function only
 * preserves that historical CommonJS constructor shape.
 */
function callableInterface(InterfaceClass) {
  function Interface(...args) {
    return new InterfaceClass(...args);
  }
  Interface.prototype = InterfaceClass.prototype;
  return Interface;
}

/**
 * The node-internal module ids these files stand in for.
 *
 * One test reaches for `internal/readline/utils` to drive the key decoder
 * directly -- feeding it escape sequences and reading back the keys, which is
 * the only way to test a terminal without a terminal. `CSI` is there because
 * the same file owns the escape sequences, even though ours live one directory
 * up so that `console.clear()` can have them without a line editor.
 */
export function internals() {
  return {
    "internal/readline/utils": {
      CSI: nodeCSI(),
      charLengthAt: utils.charLengthAt,
      charLengthLeft: utils.charLengthLeft,
      commonPrefix: utils.commonPrefix,
      emitKeys: utils.emitKeys,
      reverseString: utils.reverseString,
      kSubstringSearch: utils.kSubstringSearch,
    },
    // Four of node's readline tests measure the width of what they expect to
    // be on screen, and reach for the same helper `Interface` uses to decide
    // where the cursor goes. Handing them ours rather than node's is the
    // difference between the test checking our arithmetic and checking that
    // two copies of node's agree.
    "internal/util/inspect": {
      getStringWidth,
      stripVTControlCharacters,
      inspect,
    },
    "internal/readline/callbacks": {
      clearLine: callbacks.clearLine,
      clearScreenDown: callbacks.clearScreenDown,
      cursorTo: callbacks.cursorTo,
      moveCursor: callbacks.moveCursor,
    },
  };
}

/** Node's callable CSI function with its observable function-object fields. */
function nodeCSI() {
  const CSI = (strings, ...args) => callbacks.csi(strings, ...args);
  CSI.kEscape = callbacks.kEscape;
  CSI.kClearToLineBeginning = callbacks.kClearToLineBeginning;
  CSI.kClearToLineEnd = callbacks.kClearToLineEnd;
  CSI.kClearLine = callbacks.kClearLine;
  CSI.kClearScreenDown = callbacks.kClearScreenDown;
  return CSI;
}
