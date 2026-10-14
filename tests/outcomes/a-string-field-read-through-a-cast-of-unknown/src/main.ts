// **A class's `string` field, read through an interface that types it
// `unknown` after the object passed through `unknown`, is not a string to
// `typeof`.** `nameOf` casts `value as Named` and asks
// `typeof named.displayName === "string"`. Given a `Context` whose
// `displayName` field is a `string` holding "Ctx", node answers `Ctx`; nts
// answers `none`. Nothing is refused: this is a silent wrong answer.
//
// **Control**, in this file: the same read of a `PlainContext`, whose field
// is typed `unknown` (one line apart from `Context`), through the same
// `nameOf`. It agrees.
//
// It is an unchecked unerase to a laid-out type, like
// outcomes/an-object-read-through-another-interface, but here the offsets
// agree and the field's representation does not: a `string` slot read as an
// erased value.
//
// **Found by the React lane**, reducing
// blockers/a-narrowed-read-of-an-unknown-field-a-class-holds-as-a-string.
// React's getComponentNameFromFiber.ts:54 and getComponentNameFromType.ts:33
// read component names this way (`value as Named`, `displayName?: unknown`).
// Measured the same on da4a2a4a8 and efc71ad44.
//
// **Expected, confirmed under node:**
//
//     a string field through the cast              Ctx
//     an unknown field through the cast (control)  Ctx
interface Named {
  readonly displayName?: unknown;
}

class Context {
  displayName: string = "";
}

class PlainContext {
  displayName: unknown = "";
}

function nameOf(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const named = value as Named;
    if (typeof named.displayName === "string") {
      return named.displayName;
    }
  }
  return "none";
}

const context = new Context();
context.displayName = "Ctx";
const plain = new PlainContext();
plain.displayName = "Ctx";
observe("a string field through the cast", nameOf(context));
observe("an unknown field through the cast (control)", nameOf(plain));
done();
