// Key decoding, from node v24.20.0 `lib/internal/readline/utils.js`.
//
// A terminal does not tell a program which key was pressed. It sends bytes,
// and for anything that is not a printable character those bytes are an escape
// sequence whose shape depends on which terminal is at the other end -- xterm,
// rxvt, Cygwin and putty all spell the function keys differently, and several
// of them spell the same key more than one way. `emitKeys` is the state
// machine that turns those bytes back into "the user pressed F5 with control
// held", and the size of its table is the size of that disagreement rather
// than any complexity of ours.
//
// It is a generator because the input arrives one character at a time and what
// a character means depends on the ones before it. Written as a callback-driven
// state machine every one of those positions would have to be named and stored
// by hand; as a generator the position *is* the program counter. Node made the
// same choice for the same reason.
//
// The control characters are written as `\u001b`-style escapes throughout.
// An escape written as itself is the same string to the language and an
// invisible one to every tool that will ever show you this file.

import { CSI } from "../../internal/readline-callbacks.ts";

export { CSI };

/** Above this, a code point needs two UTF-16 units. */
const SURROGATE_THRESHOLD = 0x10000;

const ESCAPE = "\u001b";
const DELETE = "\u007f";
/** The last of the C0 control characters that map to ctrl+letter. */
const LAST_CTRL_LETTER = "\u001a";

/** Where a substring search started, kept on the interface. */
export const kSubstringSearch = Symbol("kSubstringSearch");

/**
 * How many UTF-16 units the character *ending* at `i` occupies.
 *
 * Cursor movement is in characters and the string is in units, and for
 * anything outside the basic plane -- an emoji, most of CJK extension B --
 * those differ. Moving by one unit would land between the halves of a
 * surrogate pair and produce a string that is not text.
 */
export function charLengthLeft(str: string, i: number): number {
  if (i <= 0) return 0;
  if (
    (i > 1 && (str.codePointAt(i - 2) as number) >= SURROGATE_THRESHOLD) ||
    (str.codePointAt(i - 1) as number) >= SURROGATE_THRESHOLD
  ) {
    return 2;
  }
  return 1;
}

/** How many UTF-16 units the character *starting* at `i` occupies. */
export function charLengthAt(str: string, i: number): number {
  if (str.length <= i) {
    // Pretending to move right past the end, which is what completion needs:
    // it moves the cursor to where the completed text will be before the text
    // is there.
    return 1;
  }
  return (str.codePointAt(i) as number) >= SURROGATE_THRESHOLD ? 2 : 1;
}

/**
 * The longest prefix every string shares.
 *
 * Sorting first is what makes this O(n log n) rather than O(n·m): in sorted
 * order no pair can diverge earlier than the first and last do, so comparing
 * those two answers for all of them.
 */
export function commonPrefix(strings: string[]): string {
  if (strings.length === 0) return "";
  if (strings.length === 1) return strings[0] as string;
  const sorted = strings.toSorted();
  const min = sorted[0] as string;
  const max = sorted[sorted.length - 1] as string;
  for (let i = 0; i < min.length; i++) {
    if (min[i] !== max[i]) return min.slice(0, i);
  }
  return min;
}

/**
 * Reverse the order of `from`-separated parts, joining them with `to`.
 *
 * Written out rather than `split().reverse().join()` because that allocates an
 * array it immediately discards, and this runs on every refresh of a wrapped
 * line.
 */
export function reverseString(line: string, from = "\r", to = "\r"): string {
  const parts = line.split(from);
  let result = "";
  for (let i = parts.length - 1; i > 0; i--) result += parts[i] + to;
  result += parts[0];
  return result;
}

export interface Key {
  sequence: string | undefined;
  name: string | undefined;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  code?: string | undefined;
}

interface KeypressTarget {
  emit(event: string, ...args: unknown[]): unknown;
}

/**
 * Named keys, by the escape sequence that produces them.
 *
 * A table rather than node's `switch`, because every arm is data -- one
 * terminal's spelling of one key -- and none of them does anything. The
 * `shift` and `ctrl` entries are the terminals that encode a modifier in the
 * sequence itself rather than in the numeric modifier field.
 */
const NAMED: Record<string, { name: string; shift?: boolean; ctrl?: boolean }> = {
  // xterm/gnome ESC [ letter, with modifier
  "[P": { name: "f1" }, "[Q": { name: "f2" }, "[R": { name: "f3" }, "[S": { name: "f4" },
  // xterm/gnome ESC O letter, without modifier
  "OP": { name: "f1" }, "OQ": { name: "f2" }, "OR": { name: "f3" }, "OS": { name: "f4" },
  // xterm/rxvt ESC [ number ~
  "[11~": { name: "f1" }, "[12~": { name: "f2" }, "[13~": { name: "f3" }, "[14~": { name: "f4" },
  // paste bracket mode
  "[200~": { name: "paste-start" }, "[201~": { name: "paste-end" },
  // from Cygwin, and used by libuv
  "[[A": { name: "f1" }, "[[B": { name: "f2" }, "[[C": { name: "f3" },
  "[[D": { name: "f4" }, "[[E": { name: "f5" },
  // common
  "[15~": { name: "f5" }, "[17~": { name: "f6" }, "[18~": { name: "f7" },
  "[19~": { name: "f8" }, "[20~": { name: "f9" }, "[21~": { name: "f10" },
  "[23~": { name: "f11" }, "[24~": { name: "f12" },
  // xterm ESC [ letter
  "[A": { name: "up" }, "[B": { name: "down" }, "[C": { name: "right" },
  "[D": { name: "left" }, "[E": { name: "clear" }, "[F": { name: "end" },
  "[H": { name: "home" },
  // xterm/gnome ESC O letter
  "OA": { name: "up" }, "OB": { name: "down" }, "OC": { name: "right" },
  "OD": { name: "left" }, "OE": { name: "clear" }, "OF": { name: "end" },
  "OH": { name: "home" },
  // xterm/rxvt ESC [ number ~
  "[1~": { name: "home" }, "[2~": { name: "insert" }, "[3~": { name: "delete" },
  "[4~": { name: "end" }, "[5~": { name: "pageup" }, "[6~": { name: "pagedown" },
  // putty
  "[[5~": { name: "pageup" }, "[[6~": { name: "pagedown" },
  // rxvt
  "[7~": { name: "home" }, "[8~": { name: "end" },
  // rxvt, with the modifier in the sequence
  "[a": { name: "up", shift: true }, "[b": { name: "down", shift: true },
  "[c": { name: "right", shift: true }, "[d": { name: "left", shift: true },
  "[e": { name: "clear", shift: true },
  "[2$": { name: "insert", shift: true }, "[3$": { name: "delete", shift: true },
  "[5$": { name: "pageup", shift: true }, "[6$": { name: "pagedown", shift: true },
  "[7$": { name: "home", shift: true }, "[8$": { name: "end", shift: true },
  "Oa": { name: "up", ctrl: true }, "Ob": { name: "down", ctrl: true },
  "Oc": { name: "right", ctrl: true }, "Od": { name: "left", ctrl: true },
  "Oe": { name: "clear", ctrl: true },
  "[2^": { name: "insert", ctrl: true }, "[3^": { name: "delete", ctrl: true },
  "[5^": { name: "pageup", ctrl: true }, "[6^": { name: "pagedown", ctrl: true },
  "[7^": { name: "home", ctrl: true }, "[8^": { name: "end", ctrl: true },
  // misc.
  "[Z": { name: "tab", shift: true },
};

/**
 * Decode keys from a stream of characters, forever.
 *
 * Driven by `emitKeypressEvents`: each `next(ch)` hands over one character and
 * this runs until it needs another. The shapes it accepts, which node derived
 * from Midnight Commander's `lib/tty/key.c`:
 *
 * ```text
 *   ESC letter          ESC [ letter          ESC [ modifier letter
 *   ESC [ 1 ; modifier letter                 ESC [ num char
 *   ESC [ num ; modifier char                 ESC O letter
 *   ESC O modifier letter                     ESC O 1 ; modifier letter
 *   ESC N letter                              ESC [ [ num ; modifier char
 *   ESC [ [ 1 ; modifier letter               ESC ESC [ num char
 *   ESC ESC O letter
 * ```
 *
 * `char` is usually `~`, but rxvt sends `$` and `^`. The modifier is
 * `1 + shift·1 + left_alt·2 + ctrl·4 + right_alt·8`. Two leading escapes mean
 * the same as one.
 */
export function* emitKeys(stream: KeypressTarget): Generator<void, void, string> {
  for (;;) {
    let ch = yield;
    let s = ch;
    let escaped = false;
    const key: Key = {
      sequence: undefined,
      name: undefined,
      ctrl: false,
      meta: false,
      shift: false,
    };

    if (ch === ESCAPE) {
      escaped = true;
      s += (ch = yield);
      if (ch === ESCAPE) s += (ch = yield);
    }

    if (escaped && (ch === "O" || ch === "[")) {
      // An ANSI escape sequence.
      let code = ch;
      let modifier = 0;

      if (ch === "O") {
        // ESC O letter, or ESC O modifier letter.
        s += (ch = yield);
        if (ch >= "0" && ch <= "9") {
          modifier = Number(ch) - 1;
          s += (ch = yield);
        }
        code += ch;
      } else if (ch === "[") {
        s += (ch = yield);
        if (ch === "[") {
          // Some terminals send a second bracket: `ESC [ [ A`.
          code += ch;
          s += (ch = yield);
        }

        // Buffer just enough to have a complete sequence. There are two
        // families. `ESC [ 24 ; 5 ~` is Ctrl+F12 in xterm and reads as code
        // `[24~` with modifier 5, where the `;5` is optional and the number
        // runs to three digits in paste-bracket mode. `ESC [ 1 ; 5 H` is
        // Ctrl+Home and reads as code `[H` with modifier 5, where `1;` and
        // even `1` are optional.
        const cmdStart = s.length - 1;

        if (ch >= "0" && ch <= "9") {
          s += (ch = yield);
          if (ch >= "0" && ch <= "9") {
            s += (ch = yield);
            if (ch >= "0" && ch <= "9") s += (ch = yield);
          }
        }

        if (ch === ";") {
          s += (ch = yield);
          if (ch >= "0" && ch <= "9") s += yield;
        }

        const cmd = s.slice(cmdStart);
        let match: RegExpExecArray | null;

        if ((match = /^(?:(\d\d?)(?:;(\d))?([~^$])|(\d{3}~))$/.exec(cmd))) {
          if (match[4]) {
            code += match[4];
          } else {
            code += (match[1] as string) + (match[3] as string);
            modifier = Number(match[2] || 1) - 1;
          }
        } else if ((match = /^((\d;)?(\d))?([A-Za-z])$/.exec(cmd))) {
          code += match[4] as string;
          modifier = Number(match[3] || 1) - 1;
        } else {
          code += cmd;
        }
      }

      key.ctrl = !!(modifier & 4);
      // 10 rather than 8: either alt key means meta, and the left one is bit 2.
      key.meta = !!(modifier & 10);
      key.shift = !!(modifier & 1);
      key.code = code;

      const named = NAMED[code];
      if (named === undefined) {
        key.name = "undefined";
      } else {
        key.name = named.name;
        if (named.shift) key.shift = true;
        if (named.ctrl) key.ctrl = true;
      }
    } else if (ch === "\r") {
      key.name = "return";
      key.meta = escaped;
    } else if (ch === "\n") {
      // Enter, which should have been called linefeed.
      key.name = "enter";
      key.meta = escaped;
    } else if (ch === "\t") {
      key.name = "tab";
      key.meta = escaped;
    } else if (ch === "\b" || ch === DELETE) {
      // Backspace, or ctrl+h, which arrive as the same byte.
      key.name = "backspace";
      key.meta = escaped;
    } else if (ch === ESCAPE) {
      key.name = "escape";
      key.meta = escaped;
    } else if (ch === " ") {
      key.name = "space";
      key.meta = escaped;
    } else if (!escaped && ch <= LAST_CTRL_LETTER) {
      // ctrl+letter: the control characters are the letters less 0x60.
      key.name = String.fromCharCode(ch.charCodeAt(0) + "a".charCodeAt(0) - 1);
      key.ctrl = true;
    } else if (/^[0-9A-Za-z]$/.exec(ch) !== null) {
      key.name = ch.toLowerCase();
      key.shift = /^[A-Z]$/.exec(ch) !== null;
      key.meta = escaped;
    } else if (escaped) {
      // An escape followed by something unrecognised, which is usually the
      // escape key itself plus the timeout that ends the sequence.
      key.name = ch.length ? undefined : "escape";
      key.meta = true;
    }

    key.sequence = s;

    if (s.length !== 0 && (key.name !== undefined || escaped)) {
      // A named character or sequence. The sequence is withheld when escaped,
      // because the caller wants the key rather than the bytes.
      stream.emit("keypress", escaped ? undefined : s, key);
    } else if (charLengthAt(s, 0) === s.length) {
      // A single unnamed character, such as ".".
      stream.emit("keypress", s, key);
    }
    // Anything else is an unrecognised or truncated escape sequence, and
    // emitting a guess would be worse than emitting nothing.
  }
}
