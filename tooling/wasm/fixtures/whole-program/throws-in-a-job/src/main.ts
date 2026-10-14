// A throw in a promise job nothing handles: reported when the job's
// checkpoint ends, after the initializer has returned.
class Test262Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Test262Error";
  }
}
console.log("initializer");
Promise.resolve(2).then((n) => {
  throw new Test262Error(`in a job ${n}`);
});
