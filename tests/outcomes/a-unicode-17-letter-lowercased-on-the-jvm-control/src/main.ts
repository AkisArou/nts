// run: check
// backend: jvm
//
// The control for a-unicode-17-letter-lowercased-on-the-jvm: U+A64A,
// in Unicode since long before the JDK's tables, through the same
// calls. It agrees, which is what shows the version is the cause.

export function lower(seed: number): number {
  return ("Ꙋ".toLowerCase().codePointAt(0) ?? 0) + ((seed | 0) & 1);
}

export function upper(seed: number): number {
  return ("ꙋ".toUpperCase().codePointAt(0) ?? 0) + ((seed | 0) & 1);
}
