// Retained from pinned upstream `sequential/test-dgram-implicit-bind-failure.js`.
// That file inspects Node's private queue; this keeps its public error-monitor
// and repeated implicit-bind behavior using the documented lookup option.
'use strict';

const common = require('../common');
const assert = require('assert');
const EventEmitter = require('events');
const dgram = require('dgram');

const mockError = new Error('fake DNS');
const socket = dgram.createSocket({
  type: 'udp4',
  lookup: common.mustCall((address, family, callback) => {
    process.nextTick(callback, mockError);
  }, 3),
});

socket.on(EventEmitter.errorMonitor, common.mustCall((error) => {
  assert.strictEqual(error, mockError);
}, 3));

let errors = 0;
socket.on('error', common.mustCall((error) => {
  assert.strictEqual(error, mockError);
  errors++;
  if (errors === 3) socket.close();
}, 3));

socket.send('foobar', common.PORT, 'localhost');
process.nextTick(() => socket.send('foobar', common.PORT, 'localhost'));
setImmediate(() => socket.send('foobar', common.PORT, 'localhost'));
