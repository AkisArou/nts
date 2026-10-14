// A program that completes, with a job and a timer that write after the
// module's initializer has returned: the run waits for both.
console.log("initializer");
console.error("on stderr");
Promise.resolve(1).then((n) => console.log(`job ${n}`));
setTimeout(() => console.log("timer"), 0);
