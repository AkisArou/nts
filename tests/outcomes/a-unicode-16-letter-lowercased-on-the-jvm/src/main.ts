// run: check
// backend: jvm
//
// U+A7CB, a letter added in Unicode 16, lowercases to U+0264 under
// node (Unicode 17 tables) and on native, whose tables are current;
// the JVM answers through the JDK's tables (Unicode 15 on JDK 21)
// and leaves it unchanged. The version is the whole cause: the
// older-letter control beside it agrees. Found by the stage-0
// instruments (docs/foundations/unicode.md).

export function lower(seed: number): number {
  return ("\u{A7CB}".toLowerCase().codePointAt(0) ?? 0) + ((seed | 0) & 1);
}

export function upper(seed: number): number {
  return ("\u{0264}".toUpperCase().codePointAt(0) ?? 0) + ((seed | 0) & 1);
}
