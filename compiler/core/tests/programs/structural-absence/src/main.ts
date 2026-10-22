// Two faces with one machine ABI require distinct absence conversions.
interface NullInput { feed(value: string | null): unknown }
interface UndefinedInput { feed(value: string | undefined): unknown }
class EchoInput { feed(value: string | null | undefined): unknown { return value; } }
export function inputAbsences(n: number): string {
  return feedBoth([new EchoInput()], [new EchoInput()], n);
}
// Exported, so nothing bounds the classes its arrays hold and both calls keep
// their faces' dispatch; one known class would make them direct
// (`class_sets`), and the JVM would no longer need the bodies this declines.
export function feedBoth(nullable: NullInput[], optional: UndefinedInput[], n: number): string {
  const a = nullable[0].feed(null);
  const b = optional[0].feed(undefined);
  return (a === null ? "n" : "wrong") + (b === undefined ? "u" : "wrong") + n;
}

