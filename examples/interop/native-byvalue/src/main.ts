// Records passed and returned by value, printed the way `reference/main.c`
// prints them. A result is storage in this frame; an argument is read from
// the storage it points at, and C changes only its own copy.
import { mixed, point_add, rect_area, rect_inset, rect_make, tagged_next, wide_add, type Point, type Tagged, type Wide } from "c:geometry";
import { local } from "c:memory";
import { report } from "c:report";
import type { c_char, Float64, c_int, c_long } from "@nts/scalars";

function main(): void {
  const r = rect_make(1 as Float64, 2 as Float64, 10 as Float64, 20 as Float64);
  report(`rect ${r.origin.x} ${r.origin.y} ${r.size.x} ${r.size.y} area ${rect_area(r)}`);

  const inset = rect_inset(r, 1 as Float64);
  report(`inset ${inset.origin.x} ${inset.origin.y} ${inset.size.x} ${inset.size.y}`);
  // C changed its copy; ours is as it was.
  report(`unchanged ${r.origin.x} ${r.size.x}`);
  // And the result is its own storage: changing the source later leaves it.
  r.size.x = 100 as Float64;
  report(`result kept ${inset.size.x} area now ${rect_area(r)}`);

  const a = local<Point>();
  const b = local<Point>();
  a.x = 1.5 as Float64;
  a.y = -2 as Float64;
  b.x = 0.25 as Float64;
  b.y = 8 as Float64;
  const sum = point_add(a, b);
  report(`point ${sum.x} ${sum.y}`);

  const t = local<Tagged>();
  t.kind = 41 as c_int;
  t.code = 64 as c_char;
  const next = tagged_next(t);
  report(`tagged ${next.kind} ${next.code}`);

  const w = local<Wide>();
  w.a = 1n as c_long;
  w.b = 2n as c_long;
  w.c = 3n as c_long;
  const wider = wide_add(w, 1000n as c_long);
  report(`wide ${wider.a} ${wider.b} ${wider.c}`);

  report(`mixed ${mixed(r, sum, 2 as Float64, next, wider)}`);
}

main();
