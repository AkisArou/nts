// Every consuming string-append shape must preserve live views and field
// aliases. The append may reuse a unique string's spare capacity; a kept
// reference still sees its original string, and slices own copied units.
function text(seed: number): string {
  let out = "prefix:";
  for (let i = 0; i < 9; i++) out += String((seed + i) | 0);
  return out;
}

function append(out: string, seed: number, kind: number): string {
  const piece = "a\"b\\c\n☺";
  const at = (seed >>> 0) % piece.length;
  switch (kind & 7) {
    case 0: return out + piece;
    case 1: return out + String(seed);
    case 2: return out + piece[at]!;
    case 3: return out + piece.charAt(at);
    case 4: return out + String.fromCharCode(seed & 65535);
    case 5: return out + piece.slice(at, piece.length);
    case 6: return out + JSON.stringify(piece);
    default: return out + out.slice(1, 5);
  }
}

export function liveViews(seed: number, kind: number): string {
  const left = text(seed);
  const slice = left.slice(1, left.length - 1);
  const substring = left.substring(2, left.length - 2);
  const unit = left[3]!;
  const changed = append(left, seed, kind);
  return slice + "|" + substring + "|" + unit + "|" + changed;
}

export function fieldAlias(seed: number, kind: number): string {
  const holder = { text: text(seed) };
  const borrowed = holder.text;
  const changed = append(borrowed, seed, kind);
  return holder.text + "|" + changed;
}

// A closed entry for the poison/forced-collection control as well as the
// differential's string-valued exports above.
export function work(_iterations: number): number {
  for (let kind = 0; kind < 8; kind++) {
    const original = text(kind);
    const aliased = fieldAlias(kind, kind);
    if (aliased.substring(0, original.length) !== original) return 0;
    if (liveViews(kind, kind).length === 0) return 0;
  }
  return 1;
}
