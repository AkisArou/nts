# Programs written against lib.dom.d.ts

**Status: proposal, under discussion with the compiler lane (2026-10-06).**
Nothing here is built yet. Today a renderer program imports the generated
module `nts:dom`.

## The goal

A program for the renderer is ordinary DOM TypeScript, typed by the stock
`lib.dom.d.ts`:

```ts
const row = document.createElement("tr");
row.classList.add("danger");
row.addEventListener("click", (event) => { if (event.target instanceof HTMLElement) ... });
requestAnimationFrame(() => row.remove());
```

The same file runs in a browser unchanged and compiles native through nts.
Every DOM member it uses is Blink's own, called as page script's binding calls
it (`architecture.md` section 8). A member with no native binding is a
compile-time error naming the member, never a different behaviour.

## What is true today

Each fact below was measured on the compiler at 6c08170ef.

- **The type world is already right.** The fixtures' target lib includes
  DOM, so `document.createElement("div")` type-checks. Lowering refuses it:
  `NTS1001 document.createElement, a global member with no definition here`.
- **Handle-ness can be given to lib.dom's own interfaces without a compiler
  change.** An overlay merges the handle brands (`__c_chain`, `__c_host`) into
  `interface Node`, `Element`, `Document`. A brand chain is a tuple, so
  `Element`'s chain extends `Node`'s exactly as lib.dom's own inheritance
  does. The compiler then treats a lib.dom `Document` as a native handle.
- **Members do not follow yet.** A tagged member merged into lib.dom's
  `Element` -- an `@ntsSymbol` overload of `setAttribute`, or an `@ntsGet`
  property -- is refused: `setAttribute on an opaque C pointer, which has no
  method table`. It fails for a non-generic member too. The cause is
  undetermined: either TypeScript resolves the call to lib.dom's own
  overload, or tags in a `declare global` block do not reach lowering.
- **Coverage, by `tooling/chromium/bindgen/libdom.py`:**
  - lib.dom.d.ts declares 1329 members on the 22 interfaces bound today.
  - 440 are bound and 321 are in Blink's IDL but skipped, with
    `report.json` saying why.
  - The rest are not IDL attributes or operations of that interface in
    Blink: 532 CSS properties (Blink's named-property interceptor), 26
    constants, 8 iterable members, 2 stringifiers.
- **Names line up.** lib.dom.d.ts and Blink's IDL are both WebIDL, so the
  members match name for name.

## Three ways to do it

**A. A generated replacement lib.** The program drops `"dom"` from its lib
and gets a generated `lib.dom`-shaped file with the tags written in.

- For: it uses only what the compiler does today.
- Against: it forks lib.dom's types. Generics such as `createElement<K>`,
  event maps and `this` types must be copied exactly or programs type
  differently than in a browser. It drifts with every TypeScript release.
  And an editor in a project that also targets the browser sees two DOMs.

**B. An overlay that redeclares each lib.dom member with tags.** Interface
merging adds tagged overloads and properties.

- For: lib.dom stays the source of the types.
- Against:
  - every member appears twice in the editor;
  - a property redeclaration must repeat lib.dom's type exactly (TS2717);
  - overload order decides which declaration a call resolves to;
  - lib.dom's `string`/`number` are not the ABI types a binding needs
    (a view, a WebIDL-converted number).

  This is also where the experiment above stops.

**C. Bind by delegation (recommended).** lib.dom's declarations stay as they
are; a small overlay says which bound type each is implemented by:

```ts
/** @ntsBoundBy "nts:dom" Element */  interface Element {}
/** @ntsBoundBy "nts:dom" document */ declare var document: Document;
```

The compiler lowers a use of a declaration whose owner is bound by `T` --
whose own declaration has no native tags -- as the member of the same name
in `T`, at the arity the call has. That member is an ordinary tagged
declaration in `nts:dom`, the module that is generated and verified today.
The call type-checks against lib.dom; it lowers against `nts:dom`. A member
`T` lacks is a refusal naming it. The generator emits the overlay
(`@ntsBoundBy` for every interface Blink's IDL has, each to its nearest bound
interface) beside `nts:dom`.

It is not specific to the DOM: it binds declarations a program does not own
to declarations it does. `@types/node`, a GIR-described library or a
JSON-described SDK could be bound the same way.

## What C needs from the compiler

1. **The tag:** `@ntsBoundBy <module> <name>` on an interface, a `declare
   var` or a `declare function`, read on every declaration of a merged
   symbol.
2. **Handles:** a value whose static type is a bound interface has the bound
   type's handle family. Or the overlay merges brands, which already works.
3. **Members:** for a property access or call whose resolved declaration has
   no native tags, but whose receiver's static type -- or an ancestor in
   lib.dom's inheritance -- is bound:
   - look the member up by name in the bound type (properties through
     `@ntsGet`/`@ntsSet`, methods by arity);
   - coerce the arguments between representations that are already equal
     (`string` to `StringView`, a lib.dom handle type to the bound one);
   - lower as that member.
4. **Globals:** a read of a bound `declare var` lowers as a call of the bound
   nullary function (`document` to `nts:dom`'s `document()`). A call of a
   bound `declare function` lowers as the bound function
   (`requestAnimationFrame`).
5. **`instanceof`** against a bound class value (lib.dom's `declare var
   HTMLElement: { prototype: HTMLElement; ... }`) lowers as the bound type's
   check. On the adapter's side that is Blink's own
   `ScriptWrappable::GetWrapperTypeInfo()->IsSubclass(...)`, which is how
   V8's binding answers `instanceof` -- for every interface, not only those
   with `DowncastTraits`.
6. **Event listeners:** a closure typed `(ev: MouseEvent) => any` passed
   where the binding takes `Closure<(event: Event) => void>`. The event is
   the same handle; lib.dom's event maps are what make the narrower
   parameter type correct, exactly as in a browser.
   `removeEventListener(type, f)` needs the same function value to arrive as
   the same closure context each time it is passed, so the adapter can find
   the listener by identity, as the DOM does.

## What the Chromium lane does either way

- Bind numbers as WebIDL does. A `number` crosses as a `double`, and the
  adapter applies the IDL type's conversion: `long` is ToInt32;
  `[EnforceRange]` throws a TypeError; `[Clamp]` clamps. Today a
  `CNumber<"int32">` parameter leaves that to a C conversion, which is not
  WebIDL's for NaN or out-of-range values.
- `is<X>` checks through `GetWrapperTypeInfo()`, for every interface.
- `addEventListener`/`removeEventListener` with closure identity, beside
  `listen`.
- Measure lib.dom coverage on every generation (`libdom.py`), and bind the
  categories it shows:
  - CSS properties, one function per `CSSPropertyID`, which skips the name
    lookup page script's interceptor does;
  - constants;
  - iterables;
  - stringifiers.

## Open questions for the discussion

- Why the merged tagged overload does not bind today, and whether C should
  supersede B entirely.
- Whether `@ntsBoundBy` should resolve members by name and arity alone, or
  also check the bound signature against lib.dom's at compile time. The
  latter makes a drift between the two a diagnostic instead of a coercion.
- Where the overlay is enabled: by the target (`target.chromium()` adds it)
  or by the program's tsconfig.
- How this composes with MainClaude's pending branch (`lower.rs` is large and
  moving).
