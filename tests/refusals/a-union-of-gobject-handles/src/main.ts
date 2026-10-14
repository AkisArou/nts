// expect: NTS1001 a call result of unrepresentable type (a union of an opaque C pointer to _AdwCarouselIndicatorDots | an opaque C pointer to _AdwCarouselIndicatorLines) is not supported by this lowering yet
//
// A union of two GObject handle classes, as the Carousel corpus port writes
// it (`AdwCarouselIndicatorDots | AdwCarouselIndicatorLines`, chosen by a
// combo row), has no representation: the function answering the union is
// refused before the member both classes share (`orientation`, a GtkWidget
// property) is ever looked up. The wanted fix represents the union as its
// nearest common ancestor.
// Measured with the compiler built from main d753577a6 (this tree).
// Judged by blockers-check since d753577a6 gave config-less projects
// the GIR bindings in every command.
//
// Control, measured as compiling on the same binary: either class alone --
// `new CarouselIndicatorDots({})` returned and read the same way -- builds
// with no refusal; only the union changes (the two classes share the
// GtkWidget parent whose property is read).
import { CarouselIndicatorDots, CarouselIndicatorLines } from "gi:adw";
import { Orientation } from "gi:gtk";

export function pick(which: number): CarouselIndicatorDots | CarouselIndicatorLines {
  if (which === 0) return new CarouselIndicatorDots({});
  return new CarouselIndicatorLines({});
}

// The control beside it, which must stay clean: either class alone,
// returned and read the same way, with no union between.
export function readDots(): Orientation {
  const dots: CarouselIndicatorDots = new CarouselIndicatorDots({});
  return dots.orientation;
}

export function readOrientation(which: number): Orientation {
  const indicators = pick(which);
  return indicators.orientation;
}
