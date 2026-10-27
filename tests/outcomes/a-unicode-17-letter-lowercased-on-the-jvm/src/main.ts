// run: check
// backend: jvm
//
// U+A7CE, a letter added in Unicode 17 (it has no entry at all in
// Unicode 16 data), lowercases to U+A7CF under node and on native,
// whose tables are current; the JVM answers through the JDK's tables
// (Unicode 15 on JDK 21) and leaves it unchanged. Sibling of
// a-unicode-16-letter-lowercased-on-the-jvm, one version further on;
// together they bracket how far the JDK lags. The older-letter
// control beside it agrees. Found by the stage-0 instruments.

export function lower(seed: number): number {
  return ("\u{A7CE}".toLowerCase().codePointAt(0) ?? 0) + ((seed | 0) & 1);
}

export function upper(seed: number): number {
  return ("\u{A7CF}".toUpperCase().codePointAt(0) ?? 0) + ((seed | 0) & 1);
}
