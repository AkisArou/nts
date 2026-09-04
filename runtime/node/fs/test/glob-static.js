// Ordinary callback and synchronous portions of upstream
// `test/parallel/test-fs-glob.mjs`. The same upstream file also consumes
// `fs/promises.glob` through `for await`, whose async-iterator protocol is not
// part of the Native TypeScript runtime model.
'use strict';

const common = require('../common');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tmpdir = require('../common/tmpdir');
const { pathToFileURL } = require('url');

tmpdir.refresh();

const fixture = tmpdir.resolve('glob-fixture');
const absolute = tmpdir.resolve('glob-absolute');

function writeFixture(name) {
  const target = path.join(fixture, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'glob');
}

for (const name of [
  'a/one/x.txt',
  'a/one/y.js',
  'a/two/deep/z.txt',
  'a/.hidden/h.txt',
]) {
  writeFixture(name);
}
fs.mkdirSync(absolute, { recursive: true });
fs.mkdirSync(path.join(absolute, 'blue'));
fs.mkdirSync(path.join(absolute, 'red'));
fs.symlinkSync('one', path.join(fixture, 'a/link'), 'dir');

const cases = [
  ['a/*/*.txt', ['a/one/x.txt']],
  [
    'a/**',
    [
      'a',
      'a/link',
      'a/one',
      'a/one/x.txt',
      'a/one/y.js',
      'a/two',
      'a/two/deep',
      'a/two/deep/z.txt',
    ],
  ],
  ['a/{one,two}/**/*.txt', ['a/one/x.txt', 'a/two/deep/z.txt']],
  ['a/+(one|two)/**/[xyz].txt', ['a/one/x.txt', 'a/two/deep/z.txt']],
  ['a/!(two)/**', ['a/one', 'a/one/x.txt', 'a/one/y.js']],
  ['**/.hidden/**', ['a/.hidden', 'a/.hidden/h.txt']],
  ['a/**/', ['a', 'a/one', 'a/two', 'a/two/deep']],
  ['a//two//**//z.txt', ['a/two/deep/z.txt']],
  [
    ['a/one/**', 'a/**/x.txt'],
    ['a/one', 'a/one/x.txt', 'a/one/y.js'],
  ],
];

function normalize(values) {
  return values.map((value) => value.split(path.sep).join('/')).sort();
}

function glob(pattern, options) {
  return new Promise((resolve, reject) => {
    fs.glob(pattern, options, (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

function normalizeDirents(values) {
  return values.map((entry) => {
    assert.ok(entry instanceof fs.Dirent);
    return path.relative(fixture, path.join(entry.parentPath, entry.name));
  }).map((value) => value.split(path.sep).join('/')).sort();
}

(async () => {
  for (const [pattern, expected] of cases) {
    assert.deepStrictEqual(
      normalize(fs.globSync(pattern, { cwd: fixture })),
      expected,
    );
    assert.deepStrictEqual(
      normalize(await glob(pattern, { cwd: fixture })),
      expected,
    );
  }

  const absoluteExpected = [
    path.join(absolute, 'blue'),
    path.join(absolute, 'red'),
  ].sort();
  assert.deepStrictEqual(fs.globSync(`${absolute}/*`, { cwd: fixture }).sort(), absoluteExpected);
  assert.deepStrictEqual((await glob(`${absolute}/*`, { cwd: fixture })).sort(), absoluteExpected);

  const urlCwd = pathToFileURL(fixture);
  assert.deepStrictEqual(
    normalize(fs.globSync('a/*/*.txt', { cwd: urlCwd })),
    ['a/one/x.txt'],
  );
  assert.deepStrictEqual(
    normalize(await glob('a/*/*.txt', { cwd: urlCwd })),
    ['a/one/x.txt'],
  );

  const excluded = ['a', 'a/link', 'a/one', 'a/one/x.txt'];
  const excludeOptions = {
    cwd: fixture,
    exclude: ['**/*.js', 'a/two/**'],
  };
  assert.deepStrictEqual(normalize(fs.globSync('a/**', excludeOptions)), excluded);
  assert.deepStrictEqual(normalize(await glob('a/**', excludeOptions)), excluded);

  const typeExcludes = [];
  const typeOptions = {
    cwd: fixture,
    withFileTypes: true,
    exclude: (entry) => {
      assert.ok(entry instanceof fs.Dirent);
      typeExcludes.push(entry.name);
      return entry.name === 'two';
    },
  };
  const typedExpected = ['a', 'a/link', 'a/one', 'a/one/x.txt', 'a/one/y.js'];
  assert.deepStrictEqual(normalizeDirents(fs.globSync('a/**', typeOptions)), typedExpected);
  assert.deepStrictEqual(normalizeDirents(await glob('a/**', typeOptions)), typedExpected);
  assert.ok(typeExcludes.length > 0);

  const followed = [
    'a',
    'a/link',
    'a/link/x.txt',
    'a/link/y.js',
    'a/one',
    'a/one/x.txt',
    'a/one/y.js',
    'a/two',
    'a/two/deep',
    'a/two/deep/z.txt',
  ];
  assert.deepStrictEqual(
    normalize(fs.globSync('a/**', { cwd: fixture, followSymlinks: true })),
    followed,
  );
  assert.deepStrictEqual(
    normalize(await glob('a/**', { cwd: fixture, followSymlinks: true })),
    followed,
  );

  assert.throws(
    () => fs.globSync('a/**', { cwd: fixture, followSymlinks: 1 }),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );

  const file = path.join(fixture, 'plain-file');
  fs.writeFileSync(file, 'plain');
  assert.deepStrictEqual(fs.globSync('plain-file{,/child}', { cwd: fixture }), ['plain-file']);

  let synchronous = true;
  await new Promise((resolve, reject) => {
    fs.glob('a/*/*.txt', { cwd: fixture }, (error, value) => {
      try {
        assert.ifError(error);
        assert.strictEqual(synchronous, false);
        assert.deepStrictEqual(normalize(value), ['a/one/x.txt']);
        resolve();
      } catch (failure) {
        reject(failure);
      }
    });
    synchronous = false;
  });
})().then(common.mustCall()).catch((error) => {
  setImmediate(() => {
    throw error;
  });
});
