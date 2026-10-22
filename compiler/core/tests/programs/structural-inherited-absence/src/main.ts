interface NullInput { feed(value: string | null): unknown }
interface UndefinedInput { feed(value: string | undefined): unknown }
class Parent implements NullInput {
  feed(value: string | null | undefined): unknown { return value; }
}
// Each narrow candidate blocks the other face's inferred edges. Declared
// edges remain, so Child adds a new slot beside Parent's inherited slot.
class Narrow { feed(value: string | null): unknown { return value; } }
class Good implements UndefinedInput {
  feed(value: string | undefined): unknown { return value; }
}
class Child extends Parent implements UndefinedInput {}
export function inheritedAbsence(n: number): string {
  return feedEach([new Parent(), new Child()], [new Good(), new Child()], n);
}
// Exported, so nothing bounds the classes its arrays hold and the calls keep
// their faces' dispatch (`class_sets` makes calls through two known classes
// direct, and the JVM would no longer need the slot this declines).
export function feedEach(nullable: NullInput[], optional: UndefinedInput[], n: number): string {
  let answer = "";
  for (const receiver of nullable) answer += receiver.feed(null) === null ? "n" : "wrong";
  for (const receiver of optional) answer += receiver.feed(undefined) === undefined ? "u" : "wrong";
  return answer + n;
}
