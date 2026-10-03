export function isLead(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}
export function isTrail(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

export function pointAt(text: string, at: number, unicode: boolean): number {
  const first = text.charCodeAt(at);
  if (unicode && isLead(first) && at + 1 < text.length) {
    const second = text.charCodeAt(at + 1);
    if (isTrail(second)) return 0x10000 + (first - 0xd800) * 1024 + second - 0xdc00;
  }
  return first;
}

export function previousIndex(text: string, at: number, unicode: boolean): number {
  if (unicode && at >= 2 && isTrail(text.charCodeAt(at - 1)) && isLead(text.charCodeAt(at - 2))) {
    return at - 2;
  }
  return at - 1;
}

/** AdvanceStringIndex, including advancement past the end of a string. */
export function advanceStringIndex(text: string, at: number, unicode: boolean): number {
  if (at + 1 >= text.length || !unicode) return at + 1;
  return isLead(text.charCodeAt(at)) && isTrail(text.charCodeAt(at + 1)) ? at + 2 : at + 1;
}

export function lineTerminator(point: number): boolean {
  return point === 10 || point === 13 || point === 0x2028 || point === 0x2029;
}

export function pointText(point: number): string {
  if (point < 0x10000) return String.fromCharCode(point);
  return String.fromCharCode(
    0xd800 + ((point - 0x10000) >>> 10),
    0xdc00 + ((point - 0x10000) & 1023),
  );
}
