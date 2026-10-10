// Two faces with one machine ABI require distinct absence conversions.
interface NullInput { feed(value: string | null): unknown }
interface UndefinedInput { feed(value: string | undefined): unknown }
class EchoInput { feed(value: string | null | undefined): unknown { return value; } }
export function inputAbsences(n: number): string {
  const nullable: NullInput[] = [new EchoInput()];
  const optional: UndefinedInput[] = [new EchoInput()];
  const a = nullable[0].feed(null);
  const b = optional[0].feed(undefined);
  return (a === null ? "n" : "wrong") + (b === undefined ? "u" : "wrong") + n;
}

