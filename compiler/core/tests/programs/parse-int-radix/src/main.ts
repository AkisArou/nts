export function literal(text: string): number {
  return parseInt(text, 10);
}

export function omitted(text: string): number {
  return parseInt(text);
}

export function explicitUndefined(text: string): number {
  return parseInt(text, undefined);
}

export function wrappedConstant(text: string): number {
  return parseInt(text, 4294967312);
}

export function provedInt32(text: string, radix: number): number {
  return parseInt(text, radix | 0);
}

export function dynamic(text: string, radix: number): number {
  return parseInt(text, radix);
}
