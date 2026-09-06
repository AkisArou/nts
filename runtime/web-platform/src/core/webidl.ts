/** Convert a number using Web IDL's `[Clamp] unsigned short` rules. */
export function toClampedUnsignedShort(value: number): number {
  if (Number.isNaN(value) || value <= 0) return 0;
  if (value >= 65535) return 65535;

  const lower = Math.floor(value);
  const fraction = value - lower;

  if (fraction < 0.5) return lower;
  if (fraction > 0.5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

/** Convert a TypeScript string to a Web IDL scalar-value string. */
export function toUSVString(value: string): string {
  let result = "";
  let runStart = 0;

  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);

    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        index++;
        continue;
      }
    } else if (unit < 0xdc00 || unit > 0xdfff) {
      continue;
    }

    result += value.slice(runStart, index) + "\ufffd";
    runStart = index + 1;
  }

  return runStart === 0 ? value : result + value.slice(runStart);
}
