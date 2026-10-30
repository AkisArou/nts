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
  const source = new N40(new N39(new N38(new N37(new N36(new N35(new N34(new N33(new N32(new N31(new N30(new N29(new N28(new N27(new N26(new N25(new N24(new N23(new N22(new N21(new N20(new N19(new N18(new N17(new N16(new N15(new N14(new N13(new N12(new N11(new N10(new N9(new N8(new N7(new N6(new N5(new N4(new N3(new N2(new N1(make(x)))))))))))))))))))))))))))))))))))))))));
  if (x === 0) return shallow(new Flat(3));
  let got = 0;
  try {
    ({ next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { next: { value: got } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } = source);
    return got;
  } catch {
    return 23;
  }
}
