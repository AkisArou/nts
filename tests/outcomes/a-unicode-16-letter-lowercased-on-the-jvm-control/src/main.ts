// run: check
// backend: jvm
//
// The control for a-unicode-16-letter-lowercased-on-the-jvm: U+A7B2,
// in Unicode since long before the JDK's tables, through the same
// calls. It agrees, which is what shows the version is the cause.

export function lower(seed: number): number {
  return ("Ʝ".toLowerCase().codePointAt(0) ?? 0) + ((seed | 0) & 1);
}

export function upper(seed: number): number {
  return ("ɝ".toUpperCase().codePointAt(0) ?? 0) + ((seed | 0) & 1);
}
