'use strict';

// Supported, statically observable subset of Node v24.20.0
// `test/async-hooks/test-async-wrap-providers.js`. The upstream file obtains
// its oracle from a private binding and additionally requires null-prototype
// and frozen-object semantics. This retains the public table's exact ordered
// names and numeric provider ids without asserting those §13 metaobject parts.

const assert = require('assert');
const { asyncWrapProviders } = require('async_hooks');

const names = [
  'NONE',
  'DIRHANDLE',
  'DNSCHANNEL',
  'ELDHISTOGRAM',
  'FILEHANDLE',
  'FILEHANDLECLOSEREQ',
  'BLOBREADER',
  'FSEVENTWRAP',
  'FSREQCALLBACK',
  'FSREQPROMISE',
  'GETADDRINFOREQWRAP',
  'GETNAMEINFOREQWRAP',
  'HEAPSNAPSHOT',
  'HTTP2SESSION',
  'HTTP2STREAM',
  'HTTP2PING',
  'HTTP2SETTINGS',
  'HTTPINCOMINGMESSAGE',
  'HTTPCLIENTREQUEST',
  'LOCKS',
  'JSSTREAM',
  'JSUDPWRAP',
  'MESSAGEPORT',
  'PIPECONNECTWRAP',
  'PIPESERVERWRAP',
  'PIPEWRAP',
  'PROCESSWRAP',
  'PROMISE',
  'QUERYWRAP',
  'QUIC_ENDPOINT',
  'QUIC_LOGSTREAM',
  'QUIC_SESSION',
  'QUIC_STREAM',
  'QUIC_UDP',
  'SHUTDOWNWRAP',
  'SIGNALWRAP',
  'STATWATCHER',
  'STREAMPIPE',
  'TCPCONNECTWRAP',
  'TCPSERVERWRAP',
  'TCPWRAP',
  'TTYWRAP',
  'UDPSENDWRAP',
  'UDPWRAP',
  'SIGINTWATCHDOG',
  'WORKER',
  'WORKERCPUPROFILE',
  'WORKERCPUUSAGE',
  'WORKERHEAPPROFILE',
  'WORKERHEAPSNAPSHOT',
  'WORKERHEAPSTATISTICS',
  'WRITEWRAP',
  'ZLIB',
  'CHECKPRIMEREQUEST',
  'PBKDF2REQUEST',
  'KEYPAIRGENREQUEST',
  'KEYGENREQUEST',
  'KEYEXPORTREQUEST',
  'ARGON2REQUEST',
  'CIPHERREQUEST',
  'DERIVEBITSREQUEST',
  'HASHREQUEST',
  'RANDOMBYTESREQUEST',
  'RANDOMPRIMEREQUEST',
  'SCRYPTREQUEST',
  'SIGNREQUEST',
  'TLSWRAP',
  'VERIFYREQUEST',
];

assert.deepStrictEqual(Object.keys(asyncWrapProviders), names);
for (let index = 0; index < names.length; index++) {
  assert.strictEqual(asyncWrapProviders[names[index]], index, names[index]);
}
