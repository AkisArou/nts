// node:vm's Script for a browser page: the sandbox's names become parameters.
// There is no per-call timeout; the runner's own timeout bounds the page.
export class Script {
  constructor(code) { this.code = code; }
  runInNewContext(sandbox) {
    return new Function(...Object.keys(sandbox), `return (${this.code});`)(...Object.values(sandbox));
  }
}
export default { Script };
