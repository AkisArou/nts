export const cases = [
  { call: "callbackSeesScope", why: "a callback reading the enclosing scope" },
  { call: "callbackMutatesScope", why: "a callback writing an enclosing binding" },
  { call: "callbackCalledTwice", why: "a callback called more than once" },
  { call: "callbackReturnUsed", why: "a callback's return value used by the caller" },
  { call: "callbackStoredAndCalled", why: "a callback stored and called later" },
  { call: "callbackTwoArguments", why: "a callback taking two arguments" },
  { call: "callbackOverLoopVariable", why: "a callback closing over a loop variable" },
  { call: "nestedCallbacks", why: "a callback calling another callback" },
];
