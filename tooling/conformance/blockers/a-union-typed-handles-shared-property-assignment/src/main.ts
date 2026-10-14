// expect: NTS1001 a native property whose accessor `setOrientation` the handle's type does not declare as a method is not supported by this lowering yet
//
// A let of a union of two GObject handle classes, assigned from either
// branch, then written through the property both share, as the Carousel
// corpus port writes `indicators.orientation = ...`. The union has no
// single type to look the accessor up on, so the write is refused.
// (Returning the union is a-union-of-gobject-handles; this is the write
// through a variable of that type.) Measured on main d753577a6.
//
// Control beside it, which must stay clean: one class alone, written
// the same way.
import { CarouselIndicatorDots, CarouselIndicatorLines } from "gi:adw";
import { Orientation } from "gi:gtk";

export function carouselCase(which: number): void {
  let indicators: CarouselIndicatorDots | CarouselIndicatorLines;
  if (which === 0) indicators = new CarouselIndicatorDots({});
  else indicators = new CarouselIndicatorLines({});
  indicators.orientation = Orientation.HORIZONTAL;
}

export function carouselControl(): void {
  const dots = new CarouselIndicatorDots({});
  dots.orientation = Orientation.HORIZONTAL;
}
