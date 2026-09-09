export const cases = [
  { call: "ascii", why: "control: ASCII, where bytes and units coincide" },
  { call: "twoByteCharacter", why: "control: one unit, two bytes" },
  { call: "threeByteCharacter", why: "control: one unit, three bytes" },
  { call: "surrogatePair", why: "control: an astral character as two units" },
  { call: "loneHighSurrogate", why: "an unpaired high surrogate" },
  { call: "loneLowSurrogate", why: "an unpaired low surrogate" },
  { call: "loneSurrogateBetweenLetters", why: "an unpaired surrogate inside a longer string" },
];
