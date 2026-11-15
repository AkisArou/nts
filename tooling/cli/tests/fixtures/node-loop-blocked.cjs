// The caller observes readiness and the supervisor observes the sleeping task.
require('node:fs').writeFileSync(process.argv[2], 'ready');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
