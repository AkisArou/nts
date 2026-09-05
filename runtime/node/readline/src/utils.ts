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
    (i > 1 && (str.codePointAt(i - 2) ?? 0) >= SURROGATE_THRESHOLD) ||
    (str.codePointAt(i - 1) ?? 0) >= SURROGATE_THRESHOLD
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
  return (str.codePointAt(i) ?? 0) >= SURROGATE_THRESHOLD ? 2 : 1;
}

/**
 * The longest prefix every string shares.
 *
 * Sorting first is what makes this O(n log n) rather than O(n·m): in sorted
 * order no pair can diverge earlier than the first and last do, so comparing
 * those two answers for all of them.
 */
export function commonPrefix(strings: string[]): string {
  const first = strings[0];
  if (first === undefined) return "";
  if (strings.length === 1) return first;
  const sorted = strings.toSorted();
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === undefined || max === undefined) return "";
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
            code += (match[1] ?? "") + (match[3] ?? "");
            modifier = Number(match[2] || 1) - 1;
          }
        } else if ((match = /^((\d;)?(\d))?([A-Za-z])$/.exec(cmd))) {
          code += match[4] ?? "";
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

      // Pinned upstream's static switch. Besides matching Node directly, this
      // avoids allocating a dictionary and one object per entry at module
      // initialization merely to perform a fixed finite lookup.
      switch (code) {
        // xterm/gnome ESC [ letter, with modifier
        case "[P": key.name = "f1"; break;
        case "[Q": key.name = "f2"; break;
        case "[R": key.name = "f3"; break;
        case "[S": key.name = "f4"; break;

        // xterm/gnome ESC O letter, without modifier
        case "OP": key.name = "f1"; break;
        case "OQ": key.name = "f2"; break;
        case "OR": key.name = "f3"; break;
        case "OS": key.name = "f4"; break;

        // xterm/rxvt ESC [ number ~
        case "[11~": key.name = "f1"; break;
        case "[12~": key.name = "f2"; break;
        case "[13~": key.name = "f3"; break;
        case "[14~": key.name = "f4"; break;

        // Paste bracket mode
        case "[200~": key.name = "paste-start"; break;
        case "[201~": key.name = "paste-end"; break;

        // Cygwin, also used by libuv
        case "[[A": key.name = "f1"; break;
        case "[[B": key.name = "f2"; break;
        case "[[C": key.name = "f3"; break;
        case "[[D": key.name = "f4"; break;
        case "[[E": key.name = "f5"; break;

        // Common function-key spellings
        case "[15~": key.name = "f5"; break;
        case "[17~": key.name = "f6"; break;
        case "[18~": key.name = "f7"; break;
        case "[19~": key.name = "f8"; break;
        case "[20~": key.name = "f9"; break;
        case "[21~": key.name = "f10"; break;
        case "[23~": key.name = "f11"; break;
        case "[24~": key.name = "f12"; break;

        // xterm ESC [ letter
        case "[A": key.name = "up"; break;
        case "[B": key.name = "down"; break;
        case "[C": key.name = "right"; break;
        case "[D": key.name = "left"; break;
        case "[E": key.name = "clear"; break;
        case "[F": key.name = "end"; break;
        case "[H": key.name = "home"; break;

        // xterm/gnome ESC O letter
        case "OA": key.name = "up"; break;
        case "OB": key.name = "down"; break;
        case "OC": key.name = "right"; break;
        case "OD": key.name = "left"; break;
        case "OE": key.name = "clear"; break;
        case "OF": key.name = "end"; break;
        case "OH": key.name = "home"; break;

        // xterm/rxvt ESC [ number ~
        case "[1~": key.name = "home"; break;
        case "[2~": key.name = "insert"; break;
        case "[3~": key.name = "delete"; break;
        case "[4~": key.name = "end"; break;
        case "[5~": key.name = "pageup"; break;
        case "[6~": key.name = "pagedown"; break;

        // PuTTY
        case "[[5~": key.name = "pageup"; break;
        case "[[6~": key.name = "pagedown"; break;

        // rxvt
        case "[7~": key.name = "home"; break;
        case "[8~": key.name = "end"; break;

        // rxvt carries these modifiers in the sequence itself.
        case "[a": key.name = "up"; key.shift = true; break;
        case "[b": key.name = "down"; key.shift = true; break;
        case "[c": key.name = "right"; key.shift = true; break;
        case "[d": key.name = "left"; key.shift = true; break;
        case "[e": key.name = "clear"; key.shift = true; break;
        case "[2$": key.name = "insert"; key.shift = true; break;
        case "[3$": key.name = "delete"; key.shift = true; break;
        case "[5$": key.name = "pageup"; key.shift = true; break;
        case "[6$": key.name = "pagedown"; key.shift = true; break;
        case "[7$": key.name = "home"; key.shift = true; break;
        case "[8$": key.name = "end"; key.shift = true; break;
        case "Oa": key.name = "up"; key.ctrl = true; break;
        case "Ob": key.name = "down"; key.ctrl = true; break;
        case "Oc": key.name = "right"; key.ctrl = true; break;
        case "Od": key.name = "left"; key.ctrl = true; break;
        case "Oe": key.name = "clear"; key.ctrl = true; break;
        case "[2^": key.name = "insert"; key.ctrl = true; break;
        case "[3^": key.name = "delete"; key.ctrl = true; break;
        case "[5^": key.name = "pageup"; key.ctrl = true; break;
        case "[6^": key.name = "pagedown"; key.ctrl = true; break;
        case "[7^": key.name = "home"; key.ctrl = true; break;
        case "[8^": key.name = "end"; key.ctrl = true; break;

        case "[Z": key.name = "tab"; key.shift = true; break;
        default: key.name = "undefined";
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
