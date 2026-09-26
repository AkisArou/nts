// Lone surrogates, at run time (`pick` hides the literals from the folder):
// distinct lone surrogates compare equal, `.length` is not 1, `charCodeAt` is
// not the unit. No diagnostic. Found by test262's S11.8.1_A4.12_T1 and
// S11.8.2_A4.12_T1 (`"\uD800" < "\uDC00"`).
//
// **The cause (diagnosed by the compiler lane, by reading):** a lone surrogate
// reaches HIR as *three* U+FFFD -- which is exactly `length=3` and
// `unit=65533` below, and why two distinct lone surrogates compare equal (both
// are the same three FFFDs, so the folder is right to call them equal). tsgo
// preserves the surrogate as WTF-8 and the AST string table is byte-faithful,
// but `lower_string` takes the value from the checker's literal *type*, which
// crosses the frontend protocol as `json.Marshal` inside the msgpack framing --
// and Go's encoding/json replaces each invalid UTF-8 byte with U+FFFD, three for
// a surrogate. The byte-faithful path already exists beside the lossy one: read
// the node's own text in `lower_string` and decode WTF-8 in the string table.
const pool: string[] = [];
function pick(s: string): string {
  pool.push(s);
  return pool[pool.length - 1];
}
observe("equal", String(pick("\uD800") === pick("\uDC00")));
observe("less", String(pick("\uD800") < pick("\uDC00")));
observe("length", String(pick("\uD800").length));
observe("unit", String(pick("\uD800").charCodeAt(0)));
done();
