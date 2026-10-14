// The declaring module. Nothing here reads a member: every use is in
// `main.ts`, across the edge, which is the whole point of the fixture.

export enum Align {
  Fill,
  Start,
  End = 5,
  Center,
}

export const enum Weight {
  Thin = 100,
  Bold = 700,
}

export enum Label {
  Short = "s",
  Long = "long",
}
