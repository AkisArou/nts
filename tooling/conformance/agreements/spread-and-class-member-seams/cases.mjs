export const cases = [
  { call: "staticField", why: "a static field read through the class" },
  { call: "staticMethod", why: "a static method called through the class" },
  { call: "privateField", why: "a private field read by a method of the class" },
  { call: "instanceGetter", why: "a getter on a class instance" },
  { call: "instanceSetter", why: "a setter on a class instance" },
  { call: "restCollects", why: "a rest parameter collecting extra arguments" },
  { call: "spreadIntoACall", why: "spreading a tuple into a call" },
  { call: "spreadIntoAnArray", why: "array spread into another array" },
  { call: "destructuringRest", why: "array destructuring with a rest" },
  { call: "destructuringRename", why: "object destructuring renaming a field" },
];
