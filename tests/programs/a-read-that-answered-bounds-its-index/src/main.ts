// A checked `charCodeAt` answers NaN past either end of its string, so where
// its result passed a comparison that rules NaN out, the index it read at was
// a position of the string -- though nothing compared the index with the
// length. `skipDigits` scans `while (isDigit(...)) at++` the way json-parse's
// `numberFailurePosition` does: `at` had no other bound, widened past the
// safe integers, and the field it is stored into was a double for every one
// of its stores. Now the field is an integer.
//
// `ToTerminator` is the control: the same scan stopped by `!==`, whose true
// edge is taken by NaN too, so it proves nothing about the read and its field
// stays a double.
//
// expect-ir: all: field Scanner.at is integer
// expect-ir: all: field ToTerminator.at is float

class Scanner {
  at = 0;
  readonly source: string;
  constructor(source: string) {
    this.source = source;
  }
}

// Its fields in another order, so its layout shares no prefix with
// `Scanner`'s: field facts are joined across layouts that begin alike, and
// its unbounded `at` would decide `Scanner.at` too.
class ToTerminator {
  readonly terminator = 120;
  readonly source: string;
  at = 0;
  constructor(source: string) {
    this.source = source;
  }
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function skipDigits(scanner: Scanner): void {
  let at = scanner.at;
  while (isDigit(scanner.source.charCodeAt(at))) at++;
  scanner.at = at;
}

function skipToX(scanner: ToTerminator): void {
  let at = scanner.at;
  while (scanner.source.charCodeAt(at) !== scanner.terminator) at++;
  scanner.at = at;
}

export function digits(seed: number): number {
  const scanner = new Scanner(`${(seed >>> 0) % 100000}x${seed & 7}`);
  skipDigits(scanner);
  return scanner.at;
}

export function toX(seed: number): number {
  const scanner = new ToTerminator(`${(seed >>> 0) % 1000}ax`);
  skipToX(scanner);
  return scanner.at;
}
