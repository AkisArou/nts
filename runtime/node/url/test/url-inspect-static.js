'use strict';

// Applicable public inspection behavior retained from pinned upstream
// test-whatwg-url-custom-inspect.js. Its showHidden cases require Node's
// private Ada URLContext offsets and observable constructor.name metadata.
const assert = require('assert');
const util = require('util');

const url = new URL(
  'https://username:password@host.name:8080/path/name/?que=ry#hash',
);

assert.strictEqual(
  util.inspect(url),
  `URL {
  href: 'https://username:password@host.name:8080/path/name/?que=ry#hash',
  origin: 'https://host.name:8080',
  protocol: 'https:',
  username: 'username',
  password: 'password',
  host: 'host.name:8080',
  hostname: 'host.name',
  port: '8080',
  pathname: '/path/name/',
  search: '?que=ry',
  searchParams: URLSearchParams { 'que' => 'ry' },
  hash: '#hash'
}`,
);
assert.strictEqual(util.inspect({ url }, { depth: 0 }), '{ url: URL {} }');
