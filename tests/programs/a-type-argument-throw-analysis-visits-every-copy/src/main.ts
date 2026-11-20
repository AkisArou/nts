// A generic has 70 structural class arguments, with the throwing member last
// (#888). Enumerating only the first 64 visited types silently omits C69#m,
// so its throw escapes the try. `fewer` differs only in the number of quiet
// instantiations of its own generic: 62 total arguments fit below the old
// cutoff (including the type parameter and its bound). On the resolver with
// that cutoff, fewer agrees on all 29 cases and many disagrees on 13, on C,
// LLVM and JVM. Main before #888 misses the structural throw in both arms.

class Box {
  m(): number { return 1; }
}

class C0 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 0;
  }
}

class C1 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 1;
  }
}

class C2 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 2;
  }
}

class C3 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 3;
  }
}

class C4 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 4;
  }
}

class C5 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 5;
  }
}

class C6 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 6;
  }
}

class C7 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 7;
  }
}

class C8 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 8;
  }
}

class C9 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 9;
  }
}

class C10 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 10;
  }
}

class C11 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 11;
  }
}

class C12 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 12;
  }
}

class C13 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 13;
  }
}

class C14 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 14;
  }
}

class C15 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 15;
  }
}

class C16 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 16;
  }
}

class C17 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 17;
  }
}

class C18 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 18;
  }
}

class C19 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 19;
  }
}

class C20 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 20;
  }
}

class C21 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 21;
  }
}

class C22 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 22;
  }
}

class C23 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 23;
  }
}

class C24 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 24;
  }
}

class C25 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 25;
  }
}

class C26 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 26;
  }
}

class C27 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 27;
  }
}

class C28 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 28;
  }
}

class C29 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 29;
  }
}

class C30 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 30;
  }
}

class C31 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 31;
  }
}

class C32 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 32;
  }
}

class C33 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 33;
  }
}

class C34 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 34;
  }
}

class C35 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 35;
  }
}

class C36 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 36;
  }
}

class C37 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 37;
  }
}

class C38 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 38;
  }
}

class C39 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 39;
  }
}

class C40 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 40;
  }
}

class C41 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 41;
  }
}

class C42 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 42;
  }
}

class C43 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 43;
  }
}

class C44 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 44;
  }
}

class C45 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 45;
  }
}

class C46 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 46;
  }
}

class C47 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 47;
  }
}

class C48 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 48;
  }
}

class C49 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 49;
  }
}

class C50 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 50;
  }
}

class C51 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 51;
  }
}

class C52 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 52;
  }
}

class C53 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 53;
  }
}

class C54 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 54;
  }
}

class C55 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 55;
  }
}

class C56 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 56;
  }
}

class C57 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 57;
  }
}

class C58 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 58;
  }
}

class C59 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 59;
  }
}

class C60 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 60;
  }
}

class C61 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 61;
  }
}

class C62 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 62;
  }
}

class C63 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 63;
  }
}

class C64 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 64;
  }
}

class C65 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 65;
  }
}

class C66 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 66;
  }
}

class C67 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 67;
  }
}

class C68 {
  constructor(readonly n: number) {}
  m(): number {
    return this.n + 68;
  }
}

class C69 {
  constructor(readonly n: number) {}
  m(): number {
    if (this.n > 2) { throw new RangeError("late"); }
    return this.n;
  }
}

function readFew<T extends Box>(r: T): number {
  return r.m();
}

export function fewer(n: number): number {
  try {
    let total = 0;
    total += readFew(new C0(n & 7));
    total += readFew(new C1(n & 7));
    total += readFew(new C2(n & 7));
    total += readFew(new C3(n & 7));
    total += readFew(new C4(n & 7));
    total += readFew(new C5(n & 7));
    total += readFew(new C6(n & 7));
    total += readFew(new C7(n & 7));
    total += readFew(new C8(n & 7));
    total += readFew(new C9(n & 7));
    total += readFew(new C10(n & 7));
    total += readFew(new C11(n & 7));
    total += readFew(new C12(n & 7));
    total += readFew(new C13(n & 7));
    total += readFew(new C14(n & 7));
    total += readFew(new C15(n & 7));
    total += readFew(new C16(n & 7));
    total += readFew(new C17(n & 7));
    total += readFew(new C18(n & 7));
    total += readFew(new C19(n & 7));
    total += readFew(new C20(n & 7));
    total += readFew(new C21(n & 7));
    total += readFew(new C22(n & 7));
    total += readFew(new C23(n & 7));
    total += readFew(new C24(n & 7));
    total += readFew(new C25(n & 7));
    total += readFew(new C26(n & 7));
    total += readFew(new C27(n & 7));
    total += readFew(new C28(n & 7));
    total += readFew(new C29(n & 7));
    total += readFew(new C30(n & 7));
    total += readFew(new C31(n & 7));
    total += readFew(new C32(n & 7));
    total += readFew(new C33(n & 7));
    total += readFew(new C34(n & 7));
    total += readFew(new C35(n & 7));
    total += readFew(new C36(n & 7));
    total += readFew(new C37(n & 7));
    total += readFew(new C38(n & 7));
    total += readFew(new C39(n & 7));
    total += readFew(new C40(n & 7));
    total += readFew(new C41(n & 7));
    total += readFew(new C42(n & 7));
    total += readFew(new C43(n & 7));
    total += readFew(new C44(n & 7));
    total += readFew(new C45(n & 7));
    total += readFew(new C46(n & 7));
    total += readFew(new C47(n & 7));
    total += readFew(new C48(n & 7));
    total += readFew(new C49(n & 7));
    total += readFew(new C50(n & 7));
    total += readFew(new C51(n & 7));
    total += readFew(new C52(n & 7));
    total += readFew(new C53(n & 7));
    total += readFew(new C54(n & 7));
    total += readFew(new C55(n & 7));
    total += readFew(new C56(n & 7));
    total += readFew(new C57(n & 7));
    total += readFew(new C58(n & 7));
    total += readFew(new C59(n & 7));
    total += readFew(new C60(n & 7));
    total += readFew(new C69(n & 7));
    return total;
  } catch {
    return -1;
  }
}

function readMany<T extends Box>(r: T): number {
  return r.m();
}

export function many(n: number): number {
  try {
    let total = 0;
    total += readMany(new C0(n & 7));
    total += readMany(new C1(n & 7));
    total += readMany(new C2(n & 7));
    total += readMany(new C3(n & 7));
    total += readMany(new C4(n & 7));
    total += readMany(new C5(n & 7));
    total += readMany(new C6(n & 7));
    total += readMany(new C7(n & 7));
    total += readMany(new C8(n & 7));
    total += readMany(new C9(n & 7));
    total += readMany(new C10(n & 7));
    total += readMany(new C11(n & 7));
    total += readMany(new C12(n & 7));
    total += readMany(new C13(n & 7));
    total += readMany(new C14(n & 7));
    total += readMany(new C15(n & 7));
    total += readMany(new C16(n & 7));
    total += readMany(new C17(n & 7));
    total += readMany(new C18(n & 7));
    total += readMany(new C19(n & 7));
    total += readMany(new C20(n & 7));
    total += readMany(new C21(n & 7));
    total += readMany(new C22(n & 7));
    total += readMany(new C23(n & 7));
    total += readMany(new C24(n & 7));
    total += readMany(new C25(n & 7));
    total += readMany(new C26(n & 7));
    total += readMany(new C27(n & 7));
    total += readMany(new C28(n & 7));
    total += readMany(new C29(n & 7));
    total += readMany(new C30(n & 7));
    total += readMany(new C31(n & 7));
    total += readMany(new C32(n & 7));
    total += readMany(new C33(n & 7));
    total += readMany(new C34(n & 7));
    total += readMany(new C35(n & 7));
    total += readMany(new C36(n & 7));
    total += readMany(new C37(n & 7));
    total += readMany(new C38(n & 7));
    total += readMany(new C39(n & 7));
    total += readMany(new C40(n & 7));
    total += readMany(new C41(n & 7));
    total += readMany(new C42(n & 7));
    total += readMany(new C43(n & 7));
    total += readMany(new C44(n & 7));
    total += readMany(new C45(n & 7));
    total += readMany(new C46(n & 7));
    total += readMany(new C47(n & 7));
    total += readMany(new C48(n & 7));
    total += readMany(new C49(n & 7));
    total += readMany(new C50(n & 7));
    total += readMany(new C51(n & 7));
    total += readMany(new C52(n & 7));
    total += readMany(new C53(n & 7));
    total += readMany(new C54(n & 7));
    total += readMany(new C55(n & 7));
    total += readMany(new C56(n & 7));
    total += readMany(new C57(n & 7));
    total += readMany(new C58(n & 7));
    total += readMany(new C59(n & 7));
    total += readMany(new C60(n & 7));
    total += readMany(new C61(n & 7));
    total += readMany(new C62(n & 7));
    total += readMany(new C63(n & 7));
    total += readMany(new C64(n & 7));
    total += readMany(new C65(n & 7));
    total += readMany(new C66(n & 7));
    total += readMany(new C67(n & 7));
    total += readMany(new C68(n & 7));
    total += readMany(new C69(n & 7));
    return total;
  } catch {
    return -1;
  }
}

