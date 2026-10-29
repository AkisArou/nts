// run: check
// The two derived classes differ only in their number of unused methods.
// Looking past 64 AST children must still find the base constructor and its throw.
class Base {
  constructor(n: number) {
    if (n !== 0) throw new Error("raised");
  }
}

class Control extends Base {
  constructor(n: number) { super(n); }
  m0(): number { return 0; }
  m1(): number { return 1; }
  m2(): number { return 2; }
  m3(): number { return 3; }
  m4(): number { return 4; }
  m5(): number { return 5; }
  m6(): number { return 6; }
  m7(): number { return 7; }
}

class Subject extends Base {
  constructor(n: number) { super(n); }
  m0(): number { return 0; }
  m1(): number { return 1; }
  m2(): number { return 2; }
  m3(): number { return 3; }
  m4(): number { return 4; }
  m5(): number { return 5; }
  m6(): number { return 6; }
  m7(): number { return 7; }
  m8(): number { return 8; }
  m9(): number { return 9; }
  m10(): number { return 10; }
  m11(): number { return 11; }
  m12(): number { return 12; }
  m13(): number { return 13; }
  m14(): number { return 14; }
  m15(): number { return 15; }
  m16(): number { return 16; }
  m17(): number { return 17; }
  m18(): number { return 18; }
  m19(): number { return 19; }
  m20(): number { return 20; }
  m21(): number { return 21; }
  m22(): number { return 22; }
  m23(): number { return 23; }
  m24(): number { return 24; }
  m25(): number { return 25; }
  m26(): number { return 26; }
  m27(): number { return 27; }
  m28(): number { return 28; }
  m29(): number { return 29; }
  m30(): number { return 30; }
  m31(): number { return 31; }
  m32(): number { return 32; }
  m33(): number { return 33; }
  m34(): number { return 34; }
  m35(): number { return 35; }
  m36(): number { return 36; }
  m37(): number { return 37; }
  m38(): number { return 38; }
  m39(): number { return 39; }
  m40(): number { return 40; }
  m41(): number { return 41; }
  m42(): number { return 42; }
  m43(): number { return 43; }
  m44(): number { return 44; }
  m45(): number { return 45; }
  m46(): number { return 46; }
  m47(): number { return 47; }
  m48(): number { return 48; }
  m49(): number { return 49; }
  m50(): number { return 50; }
  m51(): number { return 51; }
  m52(): number { return 52; }
  m53(): number { return 53; }
  m54(): number { return 54; }
  m55(): number { return 55; }
  m56(): number { return 56; }
  m57(): number { return 57; }
  m58(): number { return 58; }
  m59(): number { return 59; }
  m60(): number { return 60; }
  m61(): number { return 61; }
  m62(): number { return 62; }
  m63(): number { return 63; }
  m64(): number { return 64; }
  m65(): number { return 65; }
  m66(): number { return 66; }
  m67(): number { return 67; }
  m68(): number { return 68; }
  m69(): number { return 69; }
  m70(): number { return 70; }
  m71(): number { return 71; }
  m72(): number { return 72; }
  m73(): number { return 73; }
  m74(): number { return 74; }
  m75(): number { return 75; }
  m76(): number { return 76; }
  m77(): number { return 77; }
  m78(): number { return 78; }
  m79(): number { return 79; }
}

export function control(n: number): number {
  try {
    new Control(n);
    return 7;
  } catch {
    return 9;
  }
}

export function work(n: number): number {
  try {
    new Subject(n);
    return 7;
  } catch {
    return 9;
  }
}
