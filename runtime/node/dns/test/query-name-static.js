// The name a query sends, against node's: case, IDN, and names no domain holds.
//
// Preserves node v24.20.0 src/cares_wrap.cc `Query`, which passes every query
// name through `ada::idna::to_ascii` before c-ares sees it. No pinned test
// looks at what reaches the server, so this does: a local UDP server records
// each question, and the expectations are node's own answers, taken by running
// this sequence against node v24.20.0.
//
//     resolve4("Example.COM")   the server sees  example.com
//     resolve4("bücher.de")     the server sees  xn--bcher-kva.de
//     resolve4("a%b.com")       EBADNAME, nothing sent
//     resolve4("a b.com")       EBADNAME, nothing sent
//
// The server never answers, so the two that are sent time out; the resolver's
// timeout is short so they do quickly.

'use strict';

const common = require('../common');
const assert = require('assert');
const dgram = require('dgram');
const dns = require('dns');

const server = dgram.createSocket('udp4');
const seen = [];

server.on('message', (message) => {
  const labels = [];
  let at = 12;
  while (message[at] !== 0) {
    labels.push(message.subarray(at + 1, at + 1 + message[at]).toString('latin1'));
    at += message[at] + 1;
  }
  seen.push(labels.join('.'));
});

server.bind(0, '127.0.0.1', common.mustCall(() => {
  const resolver = new dns.Resolver({ timeout: 200, tries: 1 });
  resolver.setServers([`127.0.0.1:${server.address().port}`]);

  const names = ['a%b.com', 'Example.COM', 'bücher.de', 'a b.com'];
  const codes = {};
  let pending = names.length;
  for (const name of names) {
    resolver.resolve4(name, common.mustCall((error) => {
      codes[name] = error && error.code;
      if (--pending !== 0) return;
      assert.deepStrictEqual(codes, {
        'a%b.com': 'EBADNAME',
        'Example.COM': 'ETIMEOUT',
        'bücher.de': 'ETIMEOUT',
        'a b.com': 'EBADNAME',
      });
      assert.deepStrictEqual(seen.sort(), ['example.com', 'xn--bcher-kva.de']);
      server.close();
    }));
  }
}));
