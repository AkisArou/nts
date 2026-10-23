// The first link of a string chain is made with room where only the append
// after it reads it (`appended_results::consumed_left_sides`,
// `nts_str_concat_grown`), so the chain is one allocation and the appends
// after it write in place. The answers are the same either way; the core test
// `chain_links` says which link is which.
//
// `templates`: `${name}:${n},${tag}`, whose first link `name + ":"` is read
// only by the number's append. `joined`: `"{" + parts.join(",") + "}"`, whose
// first link only `+ "}"` reads. The controls differ in one thing each:
// `kept` keeps `name + ":"` in an array, so it is made to fit; `moved` begins
// with a string it made itself and gives away, which `rc` already appends to
// in place, so that link stays `nts_str_append`.

const NAMES = ["ada", "grace", "edsger", "barbara", "ken", "dennis", "niklaus", "tony"];
const TAGS = ["x", "yy", "zzz", "", "a-tag-long-enough-to-outgrow-the-room", "u", "tt", "s"];

function hash(text: string, into: number): number {
  let h = into;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  }
  return h;
}

export function templates(seed: number): number {
  const base = seed | 0;
  let h = 7;
  for (let i = 0; i < 64; i++) {
    const j = (base + i) & 63;
    const text = `${NAMES[j & 7]!}:${(i * 7919 + base) | 0},${TAGS[j >> 3]!}`;
    h = hash(text, h);
  }
  return h;
}

export function joined(seed: number): number {
  const parts: string[] = [];
  const count = 24 + ((seed | 0) & 15);
  for (let i = 0; i < count; i++) {
    parts.push(NAMES[i & 7]! + String(i));
  }
  const out = "{" + parts.join(",") + "}";
  return hash(out, out.length);
}

export function kept(seed: number): number {
  const keys: string[] = [];
  for (let i = 0; i < 16; i++) {
    keys.push(NAMES[((seed | 0) + i) & 7]! + ":");
  }
  return hash(keys.join("|"), keys.length);
}

export function moved(seed: number): number {
  let h = 3;
  for (let i = 0; i < 16; i++) {
    const made = NAMES[((seed | 0) + i) & 7]!.toUpperCase();
    const text = made + ":" + TAGS[i & 7]!;
    h = hash(text, h);
  }
  return h;
}
