// Every index is proven inside its string. The emitted module needs no length
// builtin: even the loop bounds are constants. The checker tests that shape,
// as well as UTF-16 answers against node, so restoring a per-read check reds it.
export function ascii(n: number): number {
  const text = "a\0z!";
  let total = n | 0;
  for (let at = 0; at < text.length; at++) total = (total + text.charCodeAt(at)) | 0;
  return total;
}

export function latin1(n: number): number {
  const text = "éÿ£";
  let total = n | 0;
  for (let at = 0; at < text.length; at++) total = (total + text.charCodeAt(at)) | 0;
  return total;
}

export function utf16(n: number): number {
  const text = "Ā世😀x";
  let total = n | 0;
  for (let at = 0; at < text.length; at++) total = (total + text.charCodeAt(at)) | 0;
  return total;
}
