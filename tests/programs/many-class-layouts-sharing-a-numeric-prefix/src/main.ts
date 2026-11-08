// A compile-time scaling witness: classes share sixteen numeric field names.
// The control changes only declaration order, putting each unique tag first.
// See the matching performance task in docs/plan.md.
class C0 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag0: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag0 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag0;
  }
}

class C1 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag1: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag1 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag1;
  }
}

class C2 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag2: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag2 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag2;
  }
}

class C3 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag3: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag3 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag3;
  }
}

class C4 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag4: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag4 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag4;
  }
}

class C5 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag5: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag5 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag5;
  }
}

class C6 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag6: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag6 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag6;
  }
}

class C7 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag7: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag7 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag7;
  }
}

class C8 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag8: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag8 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag8;
  }
}

class C9 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag9: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag9 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag9;
  }
}

class C10 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag10: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag10 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag10;
  }
}

class C11 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag11: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag11 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag11;
  }
}

class C12 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag12: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag12 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag12;
  }
}

class C13 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag13: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag13 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag13;
  }
}

class C14 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag14: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag14 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag14;
  }
}

class C15 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag15: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag15 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag15;
  }
}

class C16 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag16: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag16 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag16;
  }
}

class C17 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag17: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag17 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag17;
  }
}

class C18 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag18: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag18 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag18;
  }
}

class C19 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag19: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag19 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag19;
  }
}

class C20 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag20: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag20 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag20;
  }
}

class C21 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag21: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag21 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag21;
  }
}

class C22 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag22: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag22 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag22;
  }
}

class C23 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag23: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag23 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag23;
  }
}

class C24 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag24: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag24 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag24;
  }
}

class C25 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag25: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag25 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag25;
  }
}

class C26 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag26: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag26 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag26;
  }
}

class C27 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag27: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag27 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag27;
  }
}

class C28 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag28: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag28 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag28;
  }
}

class C29 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag29: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag29 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag29;
  }
}

class C30 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag30: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag30 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag30;
  }
}

class C31 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag31: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag31 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag31;
  }
}

class C32 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag32: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag32 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag32;
  }
}

class C33 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag33: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag33 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag33;
  }
}

class C34 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag34: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag34 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag34;
  }
}

class C35 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag35: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag35 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag35;
  }
}

class C36 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag36: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag36 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag36;
  }
}

class C37 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag37: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag37 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag37;
  }
}

class C38 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag38: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag38 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag38;
  }
}

class C39 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag39: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag39 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag39;
  }
}

class C40 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag40: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag40 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag40;
  }
}

class C41 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag41: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag41 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag41;
  }
}

class C42 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag42: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag42 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag42;
  }
}

class C43 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag43: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag43 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag43;
  }
}

class C44 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag44: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag44 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag44;
  }
}

class C45 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag45: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag45 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag45;
  }
}

class C46 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag46: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag46 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag46;
  }
}

class C47 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag47: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag47 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag47;
  }
}

class C48 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag48: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag48 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag48;
  }
}

class C49 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag49: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag49 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag49;
  }
}

class C50 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag50: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag50 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag50;
  }
}

class C51 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag51: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag51 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag51;
  }
}

class C52 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag52: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag52 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag52;
  }
}

class C53 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag53: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag53 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag53;
  }
}

class C54 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag54: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag54 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag54;
  }
}

class C55 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag55: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag55 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag55;
  }
}

class C56 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag56: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag56 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag56;
  }
}

class C57 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag57: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag57 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag57;
  }
}

class C58 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag58: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag58 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag58;
  }
}

class C59 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag59: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag59 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag59;
  }
}

class C60 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag60: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag60 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag60;
  }
}

class C61 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag61: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag61 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag61;
  }
}

class C62 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag62: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag62 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag62;
  }
}

class C63 {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
  p13: number;
  p14: number;
  p15: number;
  tag63: number;

  constructor(n: number) {
    this.p0 = n;
    this.p1 = n;
    this.p2 = n;
    this.p3 = n;
    this.p4 = n;
    this.p5 = n;
    this.p6 = n;
    this.p7 = n;
    this.p8 = n;
    this.p9 = n;
    this.p10 = n;
    this.p11 = n;
    this.p12 = n;
    this.p13 = n;
    this.p14 = n;
    this.p15 = n;
    this.tag63 = n;
  }

  sum(): number {
    return this.p0 + this.p1 + this.p2 + this.p3 + this.p4 + this.p5 + this.p6 + this.p7 + this.p8 + this.p9 + this.p10 + this.p11 + this.p12 + this.p13 + this.p14 + this.p15 + this.tag63;
  }
}

export function run(n: number): number { let total = 0;
  total += new C0(n).sum();
  total += new C1(n).sum();
  total += new C2(n).sum();
  total += new C3(n).sum();
  total += new C4(n).sum();
  total += new C5(n).sum();
  total += new C6(n).sum();
  total += new C7(n).sum();
  total += new C8(n).sum();
  total += new C9(n).sum();
  total += new C10(n).sum();
  total += new C11(n).sum();
  total += new C12(n).sum();
  total += new C13(n).sum();
  total += new C14(n).sum();
  total += new C15(n).sum();
  total += new C16(n).sum();
  total += new C17(n).sum();
  total += new C18(n).sum();
  total += new C19(n).sum();
  total += new C20(n).sum();
  total += new C21(n).sum();
  total += new C22(n).sum();
  total += new C23(n).sum();
  total += new C24(n).sum();
  total += new C25(n).sum();
  total += new C26(n).sum();
  total += new C27(n).sum();
  total += new C28(n).sum();
  total += new C29(n).sum();
  total += new C30(n).sum();
  total += new C31(n).sum();
  total += new C32(n).sum();
  total += new C33(n).sum();
  total += new C34(n).sum();
  total += new C35(n).sum();
  total += new C36(n).sum();
  total += new C37(n).sum();
  total += new C38(n).sum();
  total += new C39(n).sum();
  total += new C40(n).sum();
  total += new C41(n).sum();
  total += new C42(n).sum();
  total += new C43(n).sum();
  total += new C44(n).sum();
  total += new C45(n).sum();
  total += new C46(n).sum();
  total += new C47(n).sum();
  total += new C48(n).sum();
  total += new C49(n).sum();
  total += new C50(n).sum();
  total += new C51(n).sum();
  total += new C52(n).sum();
  total += new C53(n).sum();
  total += new C54(n).sum();
  total += new C55(n).sum();
  total += new C56(n).sum();
  total += new C57(n).sum();
  total += new C58(n).sum();
  total += new C59(n).sum();
  total += new C60(n).sum();
  total += new C61(n).sum();
  total += new C62(n).sum();
  total += new C63(n).sum();
return total; }
