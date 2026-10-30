// run: check
// A throwing interface getter read by an assignment pattern deeper than 32
// must remain in the effect graph. The shallow read licenses the same getter
// family independently, so losing the deep site cannot hide as a refusal.
// The control has the same declarations and differs only in pattern depth.
interface I0 { readonly value: number }
class Flat { constructor(public readonly value: number) {} }
class Leaf implements I0 {
  constructor(private x: number) {}
  get value(): number { if (this.x < 0) throw 7; return this.x + 1; }
}
function make(x: number): I0 { if (x === 0) return new Flat(3); return new Leaf(x); }
function shallow(p: I0): number { return p.value; }
class N1 { constructor(public next: I0) {} }
class N2 { constructor(public next: N1) {} }
class N3 { constructor(public next: N2) {} }
class N4 { constructor(public next: N3) {} }
class N5 { constructor(public next: N4) {} }
class N6 { constructor(public next: N5) {} }
class N7 { constructor(public next: N6) {} }
class N8 { constructor(public next: N7) {} }
class N9 { constructor(public next: N8) {} }
class N10 { constructor(public next: N9) {} }
class N11 { constructor(public next: N10) {} }
class N12 { constructor(public next: N11) {} }
class N13 { constructor(public next: N12) {} }
class N14 { constructor(public next: N13) {} }
class N15 { constructor(public next: N14) {} }
class N16 { constructor(public next: N15) {} }
class N17 { constructor(public next: N16) {} }
class N18 { constructor(public next: N17) {} }
class N19 { constructor(public next: N18) {} }
class N20 { constructor(public next: N19) {} }
class N21 { constructor(public next: N20) {} }
class N22 { constructor(public next: N21) {} }
class N23 { constructor(public next: N22) {} }
class N24 { constructor(public next: N23) {} }
class N25 { constructor(public next: N24) {} }
class N26 { constructor(public next: N25) {} }
class N27 { constructor(public next: N26) {} }
class N28 { constructor(public next: N27) {} }
class N29 { constructor(public next: N28) {} }
class N30 { constructor(public next: N29) {} }
class N31 { constructor(public next: N30) {} }
class N32 { constructor(public next: N31) {} }
class N33 { constructor(public next: N32) {} }
class N34 { constructor(public next: N33) {} }
class N35 { constructor(public next: N34) {} }
class N36 { constructor(public next: N35) {} }
class N37 { constructor(public next: N36) {} }
class N38 { constructor(public next: N37) {} }
class N39 { constructor(public next: N38) {} }
class N40 { constructor(public next: N39) {} }
export function probe(x: number): number {
  const source = new N4(new N3(new N2(new N1(make(x)))));
  if (x === 0) return shallow(new Flat(3));
  let got = 0;
  try {
    ({ next: { next: { next: { next: { value: got } } } } } = source);
    return got;
  } catch {
    return 23;
  }
}
