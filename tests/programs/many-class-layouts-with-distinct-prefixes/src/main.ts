// A compile-time scaling witness: classes share sixteen numeric field names.
// The control changes only declaration order, putting each unique tag first.
// See the matching performance task in docs/plan.md.
class C0 {
  tag0: number;
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
  tag1: number;
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
  tag2: number;
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
  tag3: number;
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
  tag4: number;
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
  tag5: number;
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
  tag6: number;
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
  tag7: number;
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
  tag8: number;
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
  tag9: number;
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
  tag10: number;
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
  tag11: number;
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
  tag12: number;
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
  tag13: number;
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
  tag14: number;
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
  tag15: number;
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
  tag16: number;
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
  tag17: number;
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
  tag18: number;
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
  tag19: number;
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
  tag20: number;
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
  tag21: number;
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
  tag22: number;
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
  tag23: number;
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
  tag24: number;
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
  tag25: number;
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
  tag26: number;
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
  tag27: number;
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
  tag28: number;
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
  tag29: number;
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
  tag30: number;
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
  tag31: number;
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
  tag32: number;
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
  tag33: number;
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
  tag34: number;
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
  tag35: number;
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
  tag36: number;
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
  tag37: number;
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
  tag38: number;
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
  tag39: number;
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
  tag40: number;
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
  tag41: number;
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
  tag42: number;
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
  tag43: number;
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
  tag44: number;
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
  tag45: number;
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
  tag46: number;
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
  tag47: number;
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
  tag48: number;
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
  tag49: number;
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
  tag50: number;
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
  tag51: number;
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
  tag52: number;
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
  tag53: number;
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
  tag54: number;
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
  tag55: number;
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
  tag56: number;
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
  tag57: number;
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
  tag58: number;
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
  tag59: number;
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
  tag60: number;
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
  tag61: number;
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
  tag62: number;
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
  tag63: number;
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
