// Retained from pinned upstream `test-dgram-send-error.js`.
// That file injects failures through Node's private native handle; these are
// the same public custom-lookup error paths without private object mutation.
'use strict';

const common = require('../common');
const assert = require('assert');
const dgram = require('dgram');

function socketWithFailingSendLookup(mockError) {
  let lookupCount = 0;
  const lookup = common.mustCall((hostname, family, callback) => {
    lookupCount++;
    if (lookupCount === 1) {
      callback(null, hostname, family);
    } else {
      callback(mockError);
    }
  }, 2);
  return dgram.createSocket({ type: 'udp4', lookup });
}

{
  const mockError = new Error('mock DNS event error');
  const socket = socketWithFailingSendLookup(mockError);
  socket.on('message', common.mustNotCall('Should not receive any messages.'));
  socket.on('error', common.mustCall((error) => {
    assert.strictEqual(error, mockError);
    socket.close();
  }));
  socket.bind(common.mustCall(() => {
    socket.send('foo', socket.address().port, 'example.invalid');
  }));
}

{
  const mockError = new Error('mock DNS callback error');
  const socket = socketWithFailingSendLookup(mockError);
  socket.on('message', common.mustNotCall('Should not receive any messages.'));
  socket.bind(common.mustCall(() => {
    socket.send(
      'foo',
      socket.address().port,
      'example.invalid',
      common.mustCall((error) => {
        assert.strictEqual(error, mockError);
        socket.close();
      }),
    );
  }));
}
