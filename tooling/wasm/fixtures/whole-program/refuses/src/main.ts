// A read past the end of an array of numbers, which this backend refuses at
// run time rather than answer.
const xs: number[] = [1, 2];
let at = 0;
for (let k = 0; k < 3; k++) at = k;
console.log("before");
console.log(xs[at] + 1);
