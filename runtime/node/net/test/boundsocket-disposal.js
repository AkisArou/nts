'use strict';

const common = require('../common');
const assert = require('assert');
const net = require('net');

const bound = new net.BoundSocket({ host: '127.0.0.1', port: 0 });
const address = bound.address();
bound[Symbol.dispose]();
bound[Symbol.dispose]();
assert.throws(() => bound.address(), { code: 'ERR_SOCKET_HANDLE_ADOPTED' });

const rebound = new net.BoundSocket({
  host: address.address,
  port: address.port,
});
rebound.close();

const adopted = new net.BoundSocket({ host: '127.0.0.1', port: 0 });
const server = net.createServer();
server.listen(adopted, common.mustCall(() => {
  assert.doesNotThrow(() => adopted[Symbol.dispose]());
  server.close(common.mustCall());
}));
