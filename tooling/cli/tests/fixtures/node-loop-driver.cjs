const assert = require('node:assert/strict');
const {Worker, isMainThread, parentPort, workerData} = require('node:worker_threads');

async function exercise(paths, count) {
  const addons = paths.map(path => require(path));
  for (const addon of addons) {
    assert.equal(addon.sameLoop(), true, 'installed loop must be the environment loop');
    assert.equal(addon.privateDefault(), true, 'bundled uv must not bind Node symbols');
  }
  const answers = await Promise.all(Array.from({length: count}, (_, i) => addons[i % addons.length].start()));
  assert.equal(answers.length, count);
  assert.ok(answers.every(answer => answer === 42));
  return answers.reduce((sum, answer) => sum + answer, 0);
}

async function main() {
  const paths = process.argv.slice(2);
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
  const sums = await Promise.all([exercise(paths, 16), ...workers]);
  const sum = sums.reduce((a, b) => a + b, 0);
  assert.equal(sum, 1344);
  console.log('host-loop-ok 32 ' + sum);
}

(isMainThread ? main() : exercise(workerData, 8).then(sum => parentPort.postMessage(sum)))
  .catch(error => { console.error(error); process.exitCode = 1; });
