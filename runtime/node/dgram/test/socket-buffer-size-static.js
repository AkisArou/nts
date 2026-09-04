// Retained from pinned upstream `test-dgram-socket-buffer-size.js`.
// The source file's exact `util.inspect` assertion observes private symbol and
// descriptor machinery; these are its applicable public API cases.
'use strict';

const common = require('../common');
const assert = require('assert');
const dgram = require('dgram');

function expectedBufferError(direction, code) {
  return (error) => {
    assert.strictEqual(error.code, 'ERR_SOCKET_BUFFER_SIZE');
    assert.strictEqual(error.name, 'SystemError');
    assert.strictEqual(error.info.code, code);
    assert.strictEqual(error.info.errno, error.errno);
    assert.strictEqual(error.info.message, code === 'EBADF' ? 'bad file descriptor' : 'invalid argument');
    assert.strictEqual(error.info.syscall, `uv_${direction}_buffer_size`);
    assert.strictEqual(error.syscall, error.info.syscall);
    return true;
  };
}

{
  const socket = dgram.createSocket('udp4');
  assert.throws(() => socket.setSendBufferSize(8192), expectedBufferError('send', 'EBADF'));
  assert.throws(() => socket.getSendBufferSize(), expectedBufferError('send', 'EBADF'));
  assert.throws(() => socket.setRecvBufferSize(8192), expectedBufferError('recv', 'EBADF'));
  assert.throws(() => socket.getRecvBufferSize(), expectedBufferError('recv', 'EBADF'));
  socket.close();
}

{
  const socket = dgram.createSocket('udp4');
  socket.bind(common.mustCall(() => {
    for (const bad of [-1, Infinity, 'Doh!']) {
      assert.throws(() => socket.setRecvBufferSize(bad), {
        code: 'ERR_SOCKET_BAD_BUFFER_SIZE',
        name: 'TypeError',
      });
      assert.throws(() => socket.setSendBufferSize(bad), {
        code: 'ERR_SOCKET_BAD_BUFFER_SIZE',
        name: 'TypeError',
      });
    }

    socket.setRecvBufferSize(10000);
    socket.setSendBufferSize(10000);
    const expected = common.isLinux ? 20000 : 10000;
    assert.strictEqual(socket.getRecvBufferSize(), expected);
    assert.strictEqual(socket.getSendBufferSize(), expected);

    assert.throws(
      () => socket.setRecvBufferSize(2147483648),
      expectedBufferError('recv', 'EINVAL'),
    );
    assert.throws(
      () => socket.setSendBufferSize(2147483648),
      expectedBufferError('send', 'EINVAL'),
    );
    socket.close();
  }));
}
