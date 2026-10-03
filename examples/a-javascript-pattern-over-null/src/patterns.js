// Destructuring patterns in JavaScript, where nothing checks the types the
// checker infers -- so a pattern can meet `null` where its type says an array.
export function nestedArray([[x]]) {
  return x;
}

export function objectInArray([{ w }]) {
  return w;
}

export function arrayInObject({ w: [x] }) {
  return x;
}
