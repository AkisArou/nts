// expect: a `new` that does not produce an object is not supported by this
//         lowering yet
//
// `new Image(width, height)` -- and `new Audio(src)`, `new Option(text,
// value)`, Blink's [LegacyFactoryFunction]s -- is refused. nts:dom binds each
// as a function named for the factory, `newImage(...)`, calling what V8's
// binding calls (HTMLImageElement::CreateForJSConstructor); the delegation
// looks for `new` + the name the *built type* is bound by,
// `newHTMLImageElement`, which does not exist and must not: `new
// HTMLImageElement()` is page script's TypeError ("Illegal constructor"), so
// a function under that name would turn it into an image. Naming the
// function for the `new` expression's callee -- `Image` here, `URL` for `new
// URL` as today -- makes both exact. Found 2026-10-13 by the Chromium lane.
//
// Control, one difference: the same program against the generated nts:dom
// module, calling the factory by name (emit-c --rc, clean):
//
//     import { newImage } from "nts:dom";
//     export function width(): number {
//       return newImage(10, 20).width;
//     }
export function width(): number {
  return new Image(10, 20).width;
}
