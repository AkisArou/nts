// The MIT License (MIT)

// Copyright (c) 2019 Paul Miller (https://paulmillr.com)

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

// Source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/bigint/noble-ed25519-bundle.js


import { sha512 } from './noble-hashes.ts';
import * as ed from './ed25519.ts';

export interface BenchmarkResult {
  fixedPublicKey: Uint8Array; publicKey: Uint8Array; signature: Uint8Array;
  asyncVerified: boolean; instanceVerified: boolean; parsedPoint: ed.Point;
  ristrettoPoint: ed.RistrettoPoint; ristrettoHex: string; montgomeryPublicKey: Uint8Array;
  sharedSecret: Uint8Array; syncPublicKey: Uint8Array; syncSignature: Uint8Array;
  syncVerified: boolean; encodingsOfSmallMultiples: Uint8Array[];
}

export async function runNobleBenchmark(): Promise<BenchmarkResult> {
  let lastFixedPublicKey: Uint8Array | undefined;
  let lastAsyncVerified: boolean | undefined;
  let lastInstanceVerified: boolean | undefined;
  let lastParsedPoint: ed.Point | undefined;
  let lastRistrettoPoint: ed.RistrettoPoint | undefined;
  let lastRistrettoHex: string | undefined;
  let lastMontgomeryPublicKey: Uint8Array | undefined;
  let lastSharedSecret: Uint8Array | undefined;
  let lastSyncPublicKey: Uint8Array | undefined;
  let lastSyncSignature: Uint8Array | undefined;
  let lastSyncVerified: boolean | undefined;
  const x = 1;

  ed.utils.precompute();

  function to64Bytes(numOrStr: bigint | string): Uint8Array {
    let hex = typeof numOrStr === 'string' ? numOrStr : numOrStr.toString(16);
    return ed.utils.hexToBytes(hex.padStart(64, '0'));
  }

  const priv1bit = to64Bytes(2n);
  const priv = to64Bytes(0x9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60n);
  const msg = to64Bytes('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');

  let pubHex: Uint8Array | undefined, sigHex: Uint8Array | undefined;
  for (var i = 0; i < 30 * x; i++) {
    pubHex = lastFixedPublicKey = await ed.getPublicKey(priv1bit);
  }

  for (var i = 0; i < 30 * x; i++) {
    pubHex = await ed.getPublicKey(ed.utils.randomPrivateKey());
  }

  for (var i = 0; i < 20 * x; i++) {
    sigHex = await ed.sign(msg, priv);
  }

  if (pubHex === undefined || sigHex === undefined)
    throw new Error('Noble benchmark did not produce its public key and signature');

  for (var i = 0; i < 4 * x; i++) {
    lastAsyncVerified = await ed.verify(sigHex, msg, pubHex);
  }

  const sigInst = ed.Signature.fromHex(sigHex);
  const pubInst = ed.Point.fromHex(pubHex);

  for (var i = 0; i < 5 * x; i++) {
    lastInstanceVerified = await ed.verify(sigInst, msg, pubInst);
  }

  for (var i = 0; i < 65 * x; i++) {
    lastParsedPoint = ed.Point.fromHex(pubHex);
  }

  const encodingsOfSmallMultiples = [
    // This is the identity point
    '0000000000000000000000000000000000000000000000000000000000000000',
    // This is the basepoint
    'e2f2ae0a6abc4e71a884a961c500515f58e30b6aa582dd8db6a65945e08d2d76',
    // These are small multiples of the basepoint
    '6a493210f7499cd17fecb510ae0cea23a110e8d5b901f8acadd3095c73a3b919',
    '94741f5d5d52755ece4f23f044ee27d5d1ea1e2bd196b462166b16152a9d0259',
    'da80862773358b466ffadfe0b3293ab3d9fd53c5ea6c955358f568322daf6a57',
    'e882b131016b52c1d3337080187cf768423efccbb517bb495ab812c4160ff44e',
    'f64746d3c92b13050ed8d80236a7f0007c3b3f962f5ba793d19a601ebb1df403',
    '44f53520926ec81fbd5a387845beb7df85a96a24ece18738bdcfa6a7822a176d',
    '903293d8f2287ebe10e2374dc1a53e0bc887e592699f02d077d5263cdd55601c',
    '02622ace8f7303a31cafc63f8fc48fdc16e1c8c8d234b2f0d6685282a9076031',
    '20706fd788b2720a1ed2a5dad4952b01f413bcf0e7564de8cdc816689e2db95f',
    'bce83f8ba5dd2fa572864c24ba1810f9522bc6004afe95877ac73241cafdab42',
    'e4549ee16b9aa03099ca208c67adafcafa4c3f3e4e5303de6026e3ca8ff84460',
    'aa52e000df2e16f55fb1032fc33bc42742dad6bd5a8fc0be0167436c5948501f',
    '46376b80f409b29dc2b5f6f0c52591990896e5716f41477cd30085ab7f10301e',
    'e0c418f7c8d9c4cdd7395b93ea124f3ad99021bb681dfc3302a9d99a2e53e64e',
  ].map((n) => ed.utils.hexToBytes(n));
  const hash = new Uint8Array([
    0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef,
    0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef,
    0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef,
    0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef,
  ]);
  for (var i = 0; i < 30 * x; i++) {
    lastRistrettoPoint = ed.RistrettoPoint.hashToCurve(hash);
  }
  for (var i = 0; i < 30 * x; i++) {
    lastRistrettoHex = ed.RistrettoPoint.fromHex(encodingsOfSmallMultiples[2]).toHex();
  }
  for (var i = 0; i < 6 * x; i++) {
    lastMontgomeryPublicKey = ed.curve25519.scalarMultBase('aeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  }
  for (var i = 0; i < 5 * x; i++) {
    lastSharedSecret = await ed.getSharedSecret(0x12345, 'aeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  }

  ed.utils.sha512Sync = (...m: Uint8Array[]) => sha512(ed.utils.concatBytes(...m));
  const { sync } = ed;

  for (var i = 0; i < 30 * x; i++) {
    lastSyncPublicKey = sync.getPublicKey(ed.utils.randomPrivateKey());
  }

  for (var i = 0; i < 20 * x; i++) {
    lastSyncSignature = sync.sign(msg, priv);
  }

  for (var i = 0; i < 4 * x; i++) {
    lastSyncVerified = sync.verify(sigHex, msg, pubHex);
  }
  if (lastFixedPublicKey === undefined || lastAsyncVerified === undefined || lastInstanceVerified === undefined ||
      lastParsedPoint === undefined || lastRistrettoPoint === undefined || lastRistrettoHex === undefined ||
      lastMontgomeryPublicKey === undefined || lastSharedSecret === undefined || lastSyncPublicKey === undefined ||
      lastSyncSignature === undefined || lastSyncVerified === undefined)
    throw new Error('Noble benchmark did not produce all operation results');
  return {
    fixedPublicKey: lastFixedPublicKey, publicKey: pubHex, signature: sigHex,
    asyncVerified: lastAsyncVerified, instanceVerified: lastInstanceVerified, parsedPoint: lastParsedPoint,
    ristrettoPoint: lastRistrettoPoint, ristrettoHex: lastRistrettoHex, montgomeryPublicKey: lastMontgomeryPublicKey,
    sharedSecret: lastSharedSecret, syncPublicKey: lastSyncPublicKey, syncSignature: lastSyncSignature,
    syncVerified: lastSyncVerified, encodingsOfSmallMultiples
  };
}
