// A template literal is a concatenation written with fewer plus signs. The
// tree is a head, then one span per substitution, each span holding its
// expression and the literal text that follows it -- so the lowering is the
// same left-to-right walk the source reads as, and the substitutions are
// evaluated in that order, which is observable because one of them may call
// something.
//
// The part that is not syntax: each substitution goes through the same
// conversion `String(n)` does, so `${n}` gets ECMAScript's `Number::toString`
// rather than a `printf` one.

function checksum(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return hash;
}

// No substitutions at all: a string literal written with different quotes.
export function noHoles(n: number): number {
  return checksum(`abc`) + n;
}

export function oneHole(n: number): number {
  return checksum(`a${n}b`);
}

export function twoHoles(n: number, m: number): number {
  return checksum(`x${n}y${m}z`);
}

// No literal text anywhere: the head is empty and so is the tail, so this is
// the conversion alone and there is nothing to join it to.
export function onlyAHole(n: number): number {
  return checksum(`${n}`);
}

// Adjacent substitutions, which is one join rather than three.
export function adjacent(n: number, m: number): number {
  return checksum(`${n}${m}`);
}

// The literal parts carry *cooked* text: `\t` is a tab, not a backslash and a
// letter. Reading the source span instead would put both characters in.
export function withEscapes(n: number): number {
  return checksum(`a\tb\nc${n}d\\e`);
}

// A string substitution needs no conversion, and a number beside it does.
export function mixed(n: number): number {
  const label = "value";
  return checksum(`${label}: ${n} (${label})`);
}

// Substitutions are evaluated left to right, and each is an arbitrary
// expression rather than a name.
export function expressions(n: number): number {
  return checksum(`${n * 2}|${n + 1}|${n / 4}`);
}

// Nesting, which is just a template inside an expression.
export function nested(n: number): number {
  return checksum(`outer[${`inner${n}`}]`);
}
