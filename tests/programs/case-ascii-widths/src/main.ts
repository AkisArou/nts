// Case conversion of one-byte strings, against node, at the widths where a
// vectorised conversion changes how it works: every length from empty to
// past four sixteen-byte blocks, and a byte outside ASCII at the edges of
// those blocks, which sends the whole string to the Latin-1 table.
//
// ASCII's letters convert by one bit, 0x20, and nothing else in ASCII has a
// case: the characters next to the letters (`@` `[` `` ` `` `{`) are where a
// range test that is off by one shows.

const alphabet = "AbCdEfGhIjKlMnOpQrStUvWxYz@[`{0189 ~!Z_az";

export function asciiEveryLength(n: number): string {
  const offset = (n | 0) & 7;
  let out = "";
  for (let length = 0; length < 70; length++) {
    let s = "";
    for (let i = 0; i < length; i++) {
      s += alphabet[(i + offset) % alphabet.length]!;
    }
    out += s.toLowerCase() + "|" + s.toUpperCase() + ";";
  }
  return out;
}

export function everyAsciiCharacter(n: number): string {
  const offset = (n | 0) & 127;
  let s = "";
  for (let i = 0; i < 128; i++) {
    s += String.fromCharCode((i + offset) & 127);
  }
  return s.toLowerCase() + "|" + s.toUpperCase();
}

// One Latin-1 byte, `É` or `ÿ`, at the first and last byte of each block.
export function oneLatin1Byte(n: number): string {
  const base = "Quick Brown Fox Jumps Over The Lazy Dog Again And Again Twice";
  const high = (n | 0) % 2 === 0 ? "É" : "ÿ";
  let out = "";
  for (const at of [0, 15, 16, 31, 32, 47, 48, 60]) {
    const s = base.slice(0, at) + high + base.slice(at);
    out += s.toLowerCase() + "|" + s.toUpperCase() + ";";
  }
  return out;
}

// Every Latin-1 character, the three whose uppercase is not one byte (`µ`,
// `ß`, `ÿ`) among them.
export function everyLatin1Character(n: number): string {
  const offset = (n | 0) & 127;
  let s = "";
  for (let i = 0; i < 128; i++) {
    s += String.fromCharCode(0x80 + ((i + offset) & 127));
  }
  const upper = s.toUpperCase();
  return s.toLowerCase() + "|" + upper + "|" + String(upper.length);
}

export function emptyString(n: number): string {
  const s = n > 1e300 ? "x" : "";
  return "[" + s.toLowerCase() + "|" + s.toUpperCase() + "]";
}

// ASCII held in two-byte storage: what is left of a string that had a unit
// above Latin-1, once it is cut away.
export function twoByteAscii(n: number): string {
  const wide = "€" + alphabet + alphabet + String(n | 0);
  const s = wide.slice(1);
  return s.toLowerCase() + "|" + s.toUpperCase();
}
