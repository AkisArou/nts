// A null or undefined receiver's TypeError names the key it was read with,
// as node names it, and runs no program code to do so: a primitive by its
// text (`-0` as `0`), a symbol by `Symbol(description)` with a description
// past 128 code units cut to its first and last 56 around `...<omitted>...`,
// and an object not at all -- its `toString` is never called.

function read(values: Record<string, number> | null | undefined, key: any): number {
  return values![key];
}

function message(values: Record<string, number> | null | undefined, key: any): string {
  try {
    return String(read(values, key));
  } catch (error) {
    return error instanceof TypeError ? error.message : "another error";
  }
}

export function stringKey(n: number): string {
  return message(null, "k" + String(n | 0));
}

export function numberKey(n: number): string {
  return message(null, n);
}

export function booleanKey(n: number): string {
  return message(undefined, n > 0);
}

export function absentKeys(n: number): string {
  return message(null, n > 0 ? undefined : null);
}

export function bigintKey(n: number): string {
  return message(null, BigInt(n | 0));
}

export function symbolKey(n: number): string {
  return message(undefined, Symbol("d" + String(n | 0)));
}

export function anonymousSymbolKey(n: number): string {
  return message(null, n > 0 ? Symbol() : Symbol(""));
}

export function longSymbolKey(n: number): string {
  const middle = (n | 0) & 63;
  return message(null, Symbol("a".repeat(60 + middle) + "|" + "b".repeat(70)));
}

export function objectKey(n: number): string {
  let coerced = "";
  const key = {
    toString(): string {
      coerced = "coerced";
      return "x" + String(n | 0);
    },
  };
  return message(null, key) + ";" + coerced;
}
