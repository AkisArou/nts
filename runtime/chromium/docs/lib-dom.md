# Programs written against lib.dom.d.ts

**Status: agreed with the compiler lane (2026-10-06): delegation (C below).**
MainClaude builds the compiler half; the Chromium lane's half is built:

- `dom/types/lib-dom-bindings.d.ts`, generated, pairs every interface
  lib.dom.d.ts and Blink's core both declare (433) with its nts:dom type and
  its `instanceof` id, plus the `document`, `requestAnimationFrame` and
  `cancelAnimationFrame` globals.
- `nts_dom_is(handle, id)` answers `instanceof` for all 603 core interfaces.
- `addEventListener`/`removeEventListener` follow the DOM's equality.
- Numbers convert as page script's binding converts them.

Until the compiler half lands, a renderer program imports the generated
module `nts:dom`.

**The compiler half, as MainClaude will build it:**

1. One `Bindings` table per program, built from the snapshot, asked through
   one function by the call, property and global-read paths. It maps each
   lib.dom type to its bound handle type (no brand merging) and each
   lib.dom member a program uses to its bound declaration.
2. Signatures are checked, not coerced. A bound member must agree with
   lib.dom's under an explicit table of equivalences: `string` and
   `StringView`; `number` and `CNumber<"double">`; a lib.dom handle and
   its bound handle along the chain. Drift is a named diagnostic at the use.
3. The target injects the overlay (`target.chromium()`), so the program's
   tsconfig is the browser's.
4. `instanceof` lowers to `nts_dom_is` with the id from `@ntsIs`.
5. A listener typed by lib.dom's event map (`(ev: MouseEvent)`) where the
   binding passes an `Event` is a trusted downcast. It is named in the
   code, with an is-check under a debug flag.
6. Listener identity: one context per closure object. This already holds,
   since lending answers the closure itself.

Gated blocker fixtures in `tooling/conformance/blockers/lib-dom-*` go green
as each piece lands.

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
- **Properties already bind by redeclaration.** An overlay redeclares
  `readonly childElementCount: number` in a merged `interface Element`,
  with `@ntsGet` naming a tagged method beside it. `div.childElementCount`
  on lib.dom's own type then lowers to Blink's getter: accessor lowering
  looks for tags across every declaration of the property's symbol. A
  getter answering `Element` behind lib.dom's `documentElement: HTMLElement`
  lowers with a trusted cast, as page script's typing implies.
- **Methods do not.** A tagged overload of `setAttribute` merged into
  `Element` is refused (`setAttribute on an opaque C pointer, which has no
  method table`), because the checker resolves the call to lib.dom's own
  declaration and lowering uses only that one. The same tagged method under
  a name lib.dom lacks (`ntsSetAttribute`) binds.
- **Globals do not.** A tagged `declare var document` is read as a C global
  variable (`v0 = document;`); `@ntsGet` on a global variable is ignored.
- **Coverage, by `tooling/chromium/bindgen/libdom.py`** (2026-10-06, 45
  interfaces, 2083 functions):
  - lib.dom.d.ts declares 1548 members on the bound interfaces.
  - 1169 are bound, the 532 CSS properties among them. Blink serves those
    through a named-property interceptor rather than its IDL, so they are
    generated from lib.dom's own list (`css_properties` in generate.py).
  - 340 are in Blink's IDL but skipped, and `report.json` says why. The
    largest groups: 221 result types (dictionaries, sequences, promises,
    enums), 23 that need a ScriptState, and 16 runtime-enabled members.
  - The rest are not attributes or operations of that interface in Blink's
    IDL: 29 constants, 8 iterable members and 2 stringifiers. lib.dom
    types the constants as literals, so a read could lower to the literal.
  - Not bound on purpose: the event-handler attributes (`onclick`), whose
    return value can cancel the event. That needs its own design.
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

## How nts:dom spells what lib.dom writes as syntax

Some of what a program writes against lib.dom is syntax, not a call: an
index signature, a rest parameter, a property whose type is a union, a
handler assignment. nts:dom binds each as named C functions, and the
compiler half picks one by the use's static types. Every row below is
generated, and checked against page script by the differential vectors.

| lib.dom.d.ts | nts:dom | chosen by |
|---|---|---|
| `el.dataset.userId` (index signature) | `_named_get(name): StringView \| null`; null is `undefined` | a read |
| `el.dataset.userId = v` | `_named_set(name, value)` | a write |
| `delete el.dataset.userId` | `_named_delete(name)`: always true, as in page script | `delete` |
| `el.append(...nodes: (Node \| string)[])` | `append_<arms>`, 0 to 3 arguments, each arm `n` (node) or `s` (string): `append_ns`, and `append_0` for none | the arguments' static types |
| `el.hidden = v` (`boolean \| "until-found"`) | `_set_hidden_boolean`, `_set_hidden_string`, `_set_hidden_number` | the value's static type |
| `el.onclick = f` | `_set_onclick_void(f)`; `_set_onclick_boolean(f)`, whose false cancels | the closure's static result type |
| `el.onclick = null` | `_set_onclick_null()` | a null write |
| `style.backgroundColor` | the property `backgroundColor`, on CSSStyleDeclaration | a read or write |
| `new URL(url, base)` | `newURL(url, base)`, one per constructor overload and arity, calling Blink's `URL::Create` | `new` on a bound interface |
| `window` (the global) | `window()` | a read of the global |
| `new MutationObserver(cb)` (and Resize, Intersection) | `newMutationObserver(cb)`, the closure called with a `MutationRecordSequence` and the observer | `new` on an observer |
| `record.addedNodes`, `observer.takeRecords()`, `event.composedPath()` (a `sequence<T>`) | `TSequence`: `length` and `item(i)` | a sequence result |
| `ctx.fill("evenodd")`, `history.scrollRestoration = "manual"` (an IDL enum) | the enum is its literal union (`type SelectionMode = "select" \| ...`), crossing as a C string matched against Blink's enum class; outside it, an argument throws the binding's TypeError and an attribute keeps its value with a console warning. A value read (`document.readyState`) is a `StringView` lent from Blink's literal, not the union yet (workarounds.md, 21) | an enum-typed argument or attribute |
| `el.attachShadow({ mode: "open" })` | `el.attachShadow("open")` (hand-written): ShadowRootInit's `mode` is a required enum, which a dictionary struct cannot carry | the mode literal |
| `canvas.getContext("2d")` | the same, typed `CanvasRenderingContext2D \| null` for the literal `"2d"` (hand-written) | the literal id |
| `ctx.fillStyle = gradient` (Blink types it `any`) | `_set_fillStyle_gradient(g)`; `ctx.fillStyle = "red"` is the property, its string arm | the value's static type |
| `new Event("x", { bubbles: true })` | `newEvent("x", { bubbles: true })`: `Fields<EventInit>`, a C struct written as the literal | a dictionary argument |
| `for (const n of nodeList)` | no binding: a loop over `item(i)` while `i < length`, re-reading `length` each step, as `%Array.prototype.values%` does | lowering of a bound indexed collection |
| `nodeList.forEach(f)` (and `classList.forEach`) | no binding: `length` read once, then `f(item(i), i, list)` for each `i` whose item is still there, as `%Array.prototype.forEach%` does; the closure is called inline and never crosses C | lowering of a value-iterable's `forEach` |

Not bound, by reason:

- The getters of `onclick` and `hidden`. One would answer the program's own
  closure, and the other's Blink side builds a V8 value directly.
- More than three variadic arguments.
- Members that need a ScriptState, or a runtime-enabled feature
  (`report.json`).

The handler slot is the program's own, as an isolated world's is. Page
script's `el.onclick` neither sees nor replaces it, and the program's write
never replaces page script's.

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
  - CSS properties: done, as CSSOM's setProperty with the dashed name,
    which is exact. A `CSSPropertyID` per property would skip one name
    lookup, but would have to replicate what setProperty checks.
  - Constants: lib.dom types them as literals, so a read can lower to the
    literal in the compiler.
  - Iterables: lowered by the compiler over `length` and `item` (the table
    above), so they need no binding.
  - Stringifiers.

## The minimal alternative the measurements show (B')

B fails only at methods and globals, so two small compiler changes would
make B work:

1. A method call whose resolved declaration has no native tags lowers
   through a tagged declaration of the same symbol at the call's arity. This
   is what accessor lowering already does for properties.
2. `@ntsGet` on a variable is honoured where the variable is read.

Its cost is the editor. The overlay's helper members show in completions on
lib.dom's types: the `_get_x` methods behind properties, the tagged
overloads with ABI types (`StringView`, `Ptr<DOMException>`), and the
`__c_chain` brand. C shows nothing but lib.dom. B' is cheaper to build; C is
cleaner for the person writing the program. `instanceof`, listener variance
and listener identity are needed either way.

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
