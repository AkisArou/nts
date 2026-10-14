// **A field an interface types `unknown`, narrowed by `typeof` to a string, on
// an object a class holds the field of as a `string`.** `nameOf`'s
// `return named.displayName` was refused once `Context` was converted to
// `Named`: the field's suppliers disagree (a `string` slot here, a `number`
// literal there), so the read goes through the field family, which is erased,
// and the read was held erased whatever the checker said -- including after the
// `typeof` test this program runs, so the `string` return could not be met.
//
// **The guard.** A family read takes the checker's narrowing when every
// supplier is a stored field (which reads back what the test read), the node is
// the read itself rather than an assertion around it, and the narrowed type is
// not the declaration. Both calls must agree with node: a `Context` whose
// field holds "Ctx", and a literal whose `displayName` is a number.
//
// **Control, in this file:** `PlainNamed`/`PlainContext`, the same program with
// the class's field typed `unknown`, which never had a family to disagree.
//
// Was `tests/refusals/` (a stage-B regression). Found by the React
// lane: getComponentNameFromFiber.ts and getComponentNameFromType.ts read
// component names this way.
interface Named {
  readonly displayName?: unknown;
}

class Context {
  displayName: string = "";
}

function nameOf(named: Named): string {
  if (typeof named.displayName === "string") {
    return named.displayName;
  }
  return "none";
}

const context = new Context();
context.displayName = "Ctx";
const held: Named = context;
observe("a class's string field", nameOf(held));
observe("a literal's number field", nameOf({ displayName: 3 }));

interface PlainNamed {
  readonly displayName?: unknown;
}

class PlainContext {
  displayName: unknown = "";
}

function plainNameOf(named: PlainNamed): string {
  if (typeof named.displayName === "string") {
    return named.displayName;
  }
  return "none";
}

const plain = new PlainContext();
plain.displayName = "Ctx";
const plainHeld: PlainNamed = plain;
observe("an unknown field (control)", plainNameOf(plainHeld));
done();
