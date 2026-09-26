// **Now a guard.** 2d1430701 runs `initialize_fields` after the inline construction
// of a provided error base, where the language puts a subclass's field
// initialisers; every arm below agrees with node on main, recorded from a clean
// build of 2d1430701. Three arms (plain class, own-class subclass, explicit
// constructor) must keep agreeing; the rest are the defect, now fixed. The
// history is kept beneath, because it is what the arms were chosen to rule out.
//
// **A subclass of a provided class with no constructor of its own never runs its
// field initialisers** -- so a declared field is both absent to `in` and, if it
// has an initialiser, missing its value. `class Kept extends Error { code = 5 }`:
// `new Kept("k").code` is 0 in nts, 5 in node. `class Coded extends Error { code?:
// number }`: `"code" in e` is false in nts, true in node (useDefineForClassFields
// defines a declared field with `undefined`). A lost value, not only an `in`.
//
// Arms, each differing from a defect arm in one thing:
//   plain class, own-class subclass     true    -- the base must be provided
//   Error / TypeError subclass, `in`    FALSE   -- defect
//   the same after `c.code = 7`         true    -- the presence bit is the right one
//   initialised field, `in`             true    -- misleading on its own: see its value
//   initialised field, value            0 vs 5  -- defect: the initialiser never ran
//   explicit `constructor(m){super(m)}` true, 5 -- only the implicit constructor
//
// **Where (the compiler lane, checked at the last step):** `lower_new`'s branch for a
// class whose `constructor(type_id)` is None calls `initialize_error` for a
// provided error base and returns before `initialize_fields`, which the sibling
// path three lines below calls ("nothing runs but this, so this site owes the
// whole chain"). An explicit constructor makes `constructor(type_id)` the subclass
// and takes the normal path. A subclass's field initialisers belong after
// `super()`, so the fix is `initialize_fields` after `initialize_error`.
//
// No reach into React's render path; the fixture is the only witness. It is the
// prerequisite for `Error.cause`, declared on lib.d.ts's interface and so
// correctly absent -- the opposite answer on the same object.
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
class Explicit extends Error {
  code?: number;
  constructor(m: string) { super(m); }
}
observe("Error subclass, explicit constructor", String("code" in new Explicit("x")));
class ExplicitKept extends Error {
  code = 5;
  constructor(m: string) { super(m); }
}
observe("explicit constructor, initialised value", String(new ExplicitKept("x").code));
class Kept extends Error { code = 5; }
const kept = new Kept("k");
observe("Error subclass, initialised field, in", String("code" in kept));
observe("Error subclass, initialised field, value", String(kept.code));
done();
