// `encodeURI`, `encodeURIComponent`, `decodeURI` and `decodeURIComponent`.
//
// A pair of pairs. The members of each differ only in a character set, which is
// why they are one lowering with two flags rather than four entry points: four
// would be four copies of the `URIError` half, and that is the half with the
// edges in it.
//
//     encodeURI("a/b?c=d")          "a/b?c=d"    the separators are structure
//     encodeURIComponent("a/b?c=d") "a%2Fb%3Fc%3Dd"
//     decodeURI("%2F")              "%2F"        and stay structure coming back
//     decodeURIComponent("%2F")     "/"
//
// `decodeURI` leaving a reserved character escaped is not a nicety: it exists to
// leave a URI's structure intact, so decoding its separators would change what
// the string means.
//
// # `URIError`, which is most of the work
//
// Both directions are specified to **throw** on input the other direction could
// not have produced, and a best effort is wrong rather than approximate:
//
//     decodeURIComponent("%GG")     a truncated or non-hex escape
//     decodeURIComponent("%C0%80")  an overlong encoding of NUL
//     decodeURIComponent("%ED%A0%80")  a surrogate, which UTF-8 excludes
//     encodeURIComponent("\uD800")  half a character, with no UTF-8 for it
//
// The overlong one is the case that is easy to be relaxed about and is the
// reason not to be: an overlong encoding is a *second spelling* of a character,
// which is how a check on the decoded text gets bypassed. `nts_string_from_utf8`
// substitutes `U+FFFD` for malformed input and so could not be reused here.
//
// A runtime function in this compiler cannot throw, so the C answers `NULL` and
// the lowering raises the `URIError` -- the same split `String.prototype.repeat`
// makes for its `RangeError`.
//
// # What it is under
//
// `decodeURIComponent` gates `querystring.parse`, which is where six of
// `querystring`'s seven failing test files stop. `blockers/missing-builtin` is
// the fixture that held it.

// A `switch` rather than an array read: a `texts[i]!` the harness cannot prove
// makes it *decline* the case, and a declined case is not a compared one.
function pick(n: number): string {
  switch (((n % 18) + 18) % 18) {
    case 0: return "abc";
    case 1: return "a b";
    case 2: return "a/b?c=d&e=f#g";
    case 3: return "é";
    case 4: return "中文";
    case 5: return "😀";
    case 6: return "-_.!~*'()";
    case 7: return ";/?:@&=+$,#";
    case 8: return "%20";
    case 9: return "%E4%B8%AD";
    case 10: return "%2F";
    case 11: return "100%";
    case 12: return "%GG";
    case 13: return "%C0%80";
    case 14: return "%ED%A0%80";
    case 15: return "%F4%90%80%80";
    case 16: return "%";
    default: return "";
  }
}

/** The length, with a thrown `URIError` folded to a sentinel. */
export function enc(n: number): number {
  try {
    return encodeURI(pick(n)).length;
  } catch {
    return -1;
  }
}

export function encComp(n: number): number {
  try {
    return encodeURIComponent(pick(n)).length;
  } catch {
    return -1;
  }
}

export function dec(n: number): number {
  try {
    return decodeURI(pick(n)).length;
  } catch {
    return -1;
  }
}

export function decComp(n: number): number {
  try {
    return decodeURIComponent(pick(n)).length;
  } catch {
    return -1;
  }
}

/**
 * The pair that says the two halves agree with *each other* and not merely with
 * node one call at a time. Everything `encodeURIComponent` produces must decode
 * back to exactly what went in.
 */
export function roundTrip(n: number): number {
  const text = pick(n);
  try {
    return decodeURIComponent(encodeURIComponent(text)) === text ? 1 : 0;
  } catch {
    return -1;
  }
}

/** The `URIError` is caught by **class**, which is how `querystring` catches it. */
export function throwsURIError(n: number): number {
  try {
    return decodeURIComponent(pick(n)).length;
  } catch (error) {
    return error instanceof URIError ? -2 : -3;
  }
}

/**
 * A character sum rather than a length, so a decode that produced the right
 * number of units with the wrong contents is caught. `length` alone agreed with
 * node on an earlier draft that had the surrogate halves the wrong way round.
 */
export function decodedContent(n: number): number {
  try {
    const out = decodeURIComponent(pick(n));
    let total = 0;
    for (let i = 0; i < out.length; i++) total = (total * 31 + out.charCodeAt(i)) | 0;
    return total;
  } catch {
    return -1;
  }
}
