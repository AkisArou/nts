// Runtime-selected decimal digit strings; every parser has to read the digits.
export function text(index: number): string {
  switch (index & 7) {
    case 0: return "1234567tail";
    case 1: return "  +7654321tail";
    case 2: return "-3141592tail";
    case 3: return "  2718281tail";
    case 4: return "+1618033tail";
    case 5: return "  -1414213tail";
    case 6: return "5772156tail";
    default: return "  -6931471tail";
  }
}
