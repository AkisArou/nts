export const cases = [
  { call: "typeofNull", why: "typeof null being object" },
  { call: "typeofArray", why: "typeof an array being object" },
  { call: "concatNotAdd", why: "string concatenation rather than addition" },
  { call: "objectIdentity", why: "two distinct objects of the same shape" },
  { call: "selfIdentity", why: "an object compared with itself" },
  { call: "instanceOfDerived", why: "instanceof following the prototype chain" },
  { call: "templateStringifies", why: "a template literal stringifying a number" },
  { call: "falsyEmptyString", why: "boolean coercion of an empty string and zero" },
  { call: "defaultEvaluatedEachCall", why: "a default parameter evaluated per call" },
  { call: "destructuringDefault", why: "a destructuring default taken only for undefined" },
];
