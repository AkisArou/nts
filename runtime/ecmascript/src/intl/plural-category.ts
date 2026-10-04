const categories: readonly Intl.LDMLPluralRule[] = ["zero", "one", "two", "few", "many", "other"];

export function pluralCategory(code: number): Intl.LDMLPluralRule {
  if (!Number.isInteger(code) || code < 0 || code >= categories.length)
    throw new Error("Invalid ICU plural category");
  return categories[code]!;
}

export function pluralCategories(mask: number): Intl.LDMLPluralRule[] {
  if (!Number.isInteger(mask) || mask < 32 || mask > 63)
    throw new Error("Invalid ICU plural category set");
  let count = 0;
  for (let index = 0; index < categories.length; index++) if ((mask & (1 << index)) !== 0) count++;
  const result = new Array<Intl.LDMLPluralRule>(count);
  let output = 0;
  for (let index = 0; index < categories.length; index++)
    if ((mask & (1 << index)) !== 0) result[output++] = categories[index]!;
  return result;
}
