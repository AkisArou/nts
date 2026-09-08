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
// All eleven are asserted here. The four that looked like composites --
// `mkdir`, `rmdir`, `rm` and `readlink` -- turned out to be single-binding calls
// like the rest: the recursion lives in the binding rather than in the
// TypeScript, so `nts_fs_mkdir_async` already takes a `recursive` flag. Reading
// them before assuming was worth a paragraph of planned work.

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

    const d2 = path.join(dir, 'd2');
    await fs.promises.mkdir(B(d2));
    assert.strictEqual(fs.statSync(d2).isDirectory(), true, 'promises.mkdir accepts a Buffer');
    await fs.promises.rmdir(B(d2));
    assert.strictEqual(fs.existsSync(d2), false, 'promises.rmdir accepts a Buffer');

    // Recursive mkdir answers the first created path as a string, even for a
    // Buffer argument -- read off node rather than assumed.
    const deep = path.join(dir, 'a', 'b', 'c');
    const created = await fs.promises.mkdir(B(deep), { recursive: true });
    assert.strictEqual(created, path.join(dir, 'a'), 'recursive promises.mkdir answers a string');
    await fs.promises.rm(B(path.join(dir, 'a')), { recursive: true });
    assert.strictEqual(fs.existsSync(path.join(dir, 'a')), false, 'promises.rm accepts a Buffer');

    fs.symlinkSync('f', g);
    assert.strictEqual(await fs.promises.readlink(B(g)), 'f', 'promises.readlink accepts a Buffer');
    assert.strictEqual(
      Buffer.isBuffer(await fs.promises.readlink(B(g), { encoding: 'buffer' })),
      true,
      'promises.readlink on a Buffer path can answer a Buffer',
    );
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
