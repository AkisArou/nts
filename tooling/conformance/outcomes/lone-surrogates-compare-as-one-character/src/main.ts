// Lone surrogates, at run time (`pick` hides the literals from the folder):
// distinct lone surrogates compare equal, `.length` is not 1, `charCodeAt` is
// not the unit. No diagnostic. Found by test262's S11.8.1_A4.12_T1 and
// S11.8.2_A4.12_T1 (`"\uD800" < "\uDC00"`).
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
