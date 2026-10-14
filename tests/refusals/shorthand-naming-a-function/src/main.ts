// expect: lowers
//
// **FIXED in fc0df644, kept as a guard.** Nothing refuses. Spelled `lowers` rather than `nothing refused`
// because the latter also requires the wrapper to carry it, and the
// wrapper's limits here are somebody else's blocker.
//
// The filing below is kept because what it argued is why the fix took the
// shape it did.
//
//
// **The name in the diagnostic is in scope.** It is a module-scope exported
// function declared in this file, it lowers on its own, and writing the same
// object literal with the property spelled out compiles. Only the shorthand
// refuses:
//
//     export const A = { lowers };            // REFUSED
//     export const B = { lowers: lowers };    // lowers
//
// Those are the same program. `{ lowers }` is sugar for `{ lowers: lowers }`,
// and the checker gives them the same type.
//
// **This is the same defect as `narrowed-shorthand-property` wearing a
// different message.** Shorthand properties are not resolved to their binding;
// what the diagnostic says depends only on what the value happens to be. A
// narrowed local gives "an erased value where a concrete representation is
// wanted"; a function gives "a shorthand naming nothing in scope". Both fixtures
// are kept, because a fix that handles one value kind and not the other would
// leave the other silently reproducing.
//
// Kept separately from the wording complaint: "naming nothing in scope" sends a
// reader looking for a typo or a missing import, and there is neither. The
// compiler already has a phrasing for the honest version of this -- it says "a
// module-scope variable whose initializer was refused above" elsewhere in the
// same run -- so the vocabulary exists and this site does not use it.
//
// **What it cost me, which is the reason the controls are here.** I found this
// in `querystring`, where `export const QueryString = { unescape, escape, ... }`
// refuses, and every name in that literal is a function that had *also* been
// refused further up. So the obvious reading was a cascade: the shorthand names
// something that did not lower, and the diagnostic is clumsy but not wrong.
//
// The control below disproves that. `lowers` is refused nowhere and `{ lowers }`
// still refuses. Had I filed the cascade story, it would have been a fixture
// that reproduced, asserted the right text, and described the wrong mechanism --
// and it would have sent the compiler lane to look at refusal propagation
// instead of at property shorthand.
//
// `querystring` is where it is worth something: `QueryString` is the module
// object node's own tests replace methods on, so `parse` and `stringify` read
// `unescape` and `escape` off it at call time rather than closing over them.

export function lowers(n: number): number {
  return n + 1;
}

// Control. Must stay clean: this is what says the defect is the shorthand and
// not the value it names.
export const Explicit = { lowers: lowers };

// Subject, at module scope -- where `querystring` has it.
export const Shorthand = { lowers };

// Subject again, inside a function body, so the fixture cannot be read as being
// about module-scope initializers.
export function inBody(): { lowers: (n: number) => number } {
  return { lowers };
}
