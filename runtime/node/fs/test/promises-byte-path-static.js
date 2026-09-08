'use strict';

// The promises half of the byte-path family.
//
// The synchronous half grew these first, and finding them there raised the
// obvious next question: does `fs.promises` accept a Buffer path? **Eleven of
// twenty-one did not**, and node accepts all of them. Same cause as the sync
// side and the same reason nothing upstream could see it: node handles the path
// as bytes in C++ from end to end, so there is no separate byte code path there
// to be wrong, and none of node's 260 `fs` test files passes a Buffer path.
//
// Seven are asserted here -- unlink, chmod, chown, utimes, rename, copyFile and
// link -- which are the ones that route straight to a single `_async` binding.
// `mkdir`, `rmdir`, `rm` and `readlink` are *not* fixed and are absent rather
// than asserted: the first three are recursive composites and `readlink` has to
// answer bytes as well, and asserting their current behaviour would pin a defect
// as expected behaviour, which is the mistake the sync family test records.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nts-fsp-bytes-'));
const B = (p) => Buffer.from(p);
const f = path.join(dir, 'f');
const g = path.join(dir, 'g');

(async () => {
  try {
    fs.writeFileSync(f, 'hello');

    fs.writeFileSync(g, 'x');
    await fs.promises.unlink(B(g));
    assert.strictEqual(fs.existsSync(g), false, 'promises.unlink accepts a Buffer');

    await fs.promises.chmod(B(f), 0o640);
    assert.strictEqual(fs.statSync(f).mode & 0o777, 0o640, 'promises.chmod accepts a Buffer');

    await fs.promises.chown(B(f), -1, -1);

    await fs.promises.utimes(B(f), 1000, 2000);
    assert.strictEqual(
      Math.round(fs.statSync(f).mtimeMs / 1000),
      2000,
      'promises.utimes accepts a Buffer',
    );

    fs.writeFileSync(g, 'x');
    await fs.promises.rename(B(g), B(`${g}2`));
    assert.strictEqual(fs.existsSync(`${g}2`), true, 'promises.rename accepts Buffers');
    fs.unlinkSync(`${g}2`);

    await fs.promises.copyFile(B(f), B(g));
    assert.strictEqual(
      fs.readFileSync(g, 'utf8'),
      fs.readFileSync(f, 'utf8'),
      'promises.copyFile accepts Buffers',
    );
    fs.unlinkSync(g);

    await fs.promises.link(B(f), B(g));
    assert.strictEqual(fs.statSync(g).ino, fs.statSync(f).ino, 'promises.link accepts Buffers');
    fs.unlinkSync(g);

    // The errno has to survive the byte route too, not just the success path.
    await assert.rejects(
      () => fs.promises.unlink(B(path.join(dir, 'absent'))),
      { code: 'ENOENT' },
      'promises.unlink on a missing Buffer path still reports ENOENT',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
