// **A declared, never-assigned class field reads absent to `in` -- only when the
// class extends a *provided* class.** At `target: esnext`, `useDefineForClassFields`
// defines a declared field with the value `undefined`, so `"code" in e` is true
// (node: `Object.getOwnPropertyNames(new C("b"))` lists it). nts answers false for
// `class Coded extends Error { code?: number }` and for a `TypeError` subclass.
//
// Arms, each differing from the defect in one thing (the first two found by the
// compiler lane, the rest here):
//   plain class                          true   -- not "a declared optional field" alone
//   own-class subclass                   true   -- not "a subclass" alone: the base is provided
//   Error / TypeError subclass           FALSE  -- the defect
//   the same, after `c.code = 7`         true   -- the presence bit is the right one:
//                                                  the assignment sets what `in` reads
//   an initialised field (`code = 5`)    true   -- only a declared-but-unassigned field
//   reading `c.code`                     undefined, as node -- so the value is right
//                                                  and only presence is wrong
// So the bit index is sound, and what is missing is marking the declared field
// present at construction when the base comes from `builtin::error_fields` --
// the constructor path for a provided base, the compiler lane's second hypothesis.
//
// No reach into React's render path (its only optional class fields are on
// ReactContext, none observed for presence); the fixture is the only witness.
// Ranked ahead of `Error.cause`, which is declared on lib.d.ts's *interface* and
// so correctly absent -- the opposite answer on the same object.
class Box { tag?: number; }
observe("plain class", String("tag" in new Box()));
class Base { base = 1; }
class Sub extends Base { tag?: number; }
observe("own-class subclass", String("tag" in new Sub()));
class Coded extends Error { code?: number; }
const c = new Coded("boom");
observe("Error subclass", String("code" in c));
observe("Error subclass, read", String(c.code));
c.code = 7;
observe("Error subclass, after assignment", String("code" in c));
class Typed extends TypeError { code?: number; }
observe("TypeError subclass", String("code" in new Typed("t")));
class Kept extends Error { code = 5; }
observe("Error subclass, initialised field", String("code" in new Kept("k")));
done();
