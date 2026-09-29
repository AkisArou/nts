// Promise.resolve(p) returns p itself when p is a promise of this
// constructor. nts makes a new one. Found by test262's Promise/resolve/
// S25.4.4.5_A2.1_T1.js. The control resolves a number twice, and two
// promises of one number are distinct in both.
const p1 = Promise.resolve(1);
const p2 = Promise.resolve(p1);
const p3 = Promise.resolve(1);
observe("of a promise", String(p1 === p2));
observe("of a number", String(p1 === p3));
done();
