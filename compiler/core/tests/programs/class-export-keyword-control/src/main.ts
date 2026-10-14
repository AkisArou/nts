// Control: only union is renamed to Ordinary; the two layouts stay different.
// `union` is a JavaScript identifier. Its factory must stay distinct from
// union_'s: the complete prefixed C symbol is an identifier in both cases.
export class Ordinary {
  flag: boolean;
  constructor(flag: boolean) { this.flag = flag; }
  get(): boolean { return this.flag; }
}

// A second field keeps the layouts different, so this tests factory naming
// independently of the shared-layout publication subject.
export class union_ {
  flag: boolean;
  extra: number;
  constructor(flag: boolean) { this.flag = !flag; this.extra = 37; }
  get(): boolean { return this.flag; }
}
