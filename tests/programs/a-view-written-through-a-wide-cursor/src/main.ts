// A typed array written through a cursor that starts at a parameter. The
// parameter is an `i32` and the count can pass 2^31, so the cursor is an `i64`
// -- `utf8Write`'s output position, which writes ten bytes a character for
// `node-utf8`. The JVM sent a checked `i64` subscript through
// the `double` form, an `l2d` and two floating compares per element, because
// the `long` bound it once had (9d94160db) was deleted when nothing reached a
// wide subscript (a768b1fc8). The compiler crate's `wide_cursor` test reads
// the class for the `long` bound; this says what the program answers.

function write(out: Uint8Array, text: string, offset: number, maximum: number): number {
  let at = offset;
  const end = offset + maximum;
  for (let i = 0; i < text.length; i++) {
    if (at + 1 > end) break;
    out[at++] = text.charCodeAt(i) & 0x7f;
  }
  return at - offset;
}

export function wide(n: number): string {
  const out = new Uint8Array(12);
  const offset = n & 7;
  const written = write(out, "wide cursor!", offset, 12 - offset);
  let text = written + ":";
  for (let i = 0; i < out.length; i++) text += out[i] + " ";
  return text;
}
