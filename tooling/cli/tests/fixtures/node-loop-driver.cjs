const assert = require('node:assert/strict');
const {Worker, isMainThread, parentPort, workerData} = require('node:worker_threads');

function load(paths) {
  const addons = paths.map(path => require(path));
  for (const addon of addons) {
    assert.equal(addon.sameLoop(), true, 'installed loop must be the environment loop');
    assert.equal(addon.privateDefault(), true, 'bundled uv must not bind Node symbols');
  }
  return addons;
}

async function exercise(addons, count) {
  const answers = await Promise.all(Array.from({length: count}, (_, i) => addons[i % addons.length].start()));
  assert.equal(answers.length, count);
  assert.ok(answers.every(answer => answer === 42));
  return answers.reduce((sum, answer) => sum + answer, 0);
}

async function main() {
  const paths = process.argv.slice(2);
  // Reject a symbol-interposed addon before acquiring any worker. Otherwise
  // the deliberate assertion failure races those workers loading the same
  // invalid native library, obscuring it with a crash or unfinished teardown.
  const addons = load(paths);
  const workers = Array.from({length: 2}, () => new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {workerData: paths});
    let sum;
    worker.once('message', value => { sum = value; });
    worker.once('error', reject);
    worker.once('exit', status => {
      if (status !== 0 || sum !== 336) reject(new Error('worker work or teardown failed'));
      else resolve(sum);
    });
  }));
  const sums = await Promise.all([exercise(addons, 16), ...workers]);
  const sum = sums.reduce((a, b) => a + b, 0);
  assert.equal(sum, 1344);
  console.log('host-loop-ok 32 ' + sum);
}

(isMainThread ? main() : exercise(load(workerData), 8).then(sum => parentPort.postMessage(sum)))
  .catch(error => { console.error(error); process.exitCode = 1; });
