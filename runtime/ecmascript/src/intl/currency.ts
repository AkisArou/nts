export function validCurrency(currency: string): boolean {
  if (currency.length !== 3) return false;
  for (let index = 0; index < 3; index++) {
    const code = currency.charCodeAt(index);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) return false;
  }
  return true;
}
