export const cases = [
  { call: "catchBindsTheValue", why: "the catch binding the thrown value" },
  { call: "finallyOnTheWayOut", why: "finally running as an exception passes through" },
  { call: "rethrowReachesOuter", why: "a rethrow reaching the outer catch" },
  { call: "throwANumber", why: "a non-Error value arriving as itself" },
  { call: "throughTwoFrames", why: "an exception crossing two frames" },
  { call: "catchStopsIt", why: "a catch inside the throwing frame's caller" },
  { call: "finallyAfterCatch", why: "finally running after a caught exception" },
];
