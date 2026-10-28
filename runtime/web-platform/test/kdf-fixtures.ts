/**
 * Fixed HKDF answers from RFC 5869 Appendix A and PBKDF2 answers from RFC 6070
 * §2. No fixture is computed with the implementation under test.
 * https://www.rfc-editor.org/rfc/rfc5869.html#appendix-A
 * https://www.rfc-editor.org/rfc/rfc6070.html#section-2
 *
 * HKDF indices 0–6 are A.1–A.7. A.7 supplies the RFC's default SHA-1-sized
 * zero salt explicitly. PBKDF2 indices 0–4 are the five cases other than the
 * 16,777,216-iteration case, omitted to keep repeated unit runs inexpensive.
 * Passwords are exact ASCII octets, including the embedded NUL in the last
 * case. Lengths are octets. Every accessor returns fresh bytes and an object.
 *
 * Portions Copyright (c) 2010 and 2011 IETF Trust and the persons identified as
 * authors of RFC 5869 and RFC 6070. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
import { Buffer } from "node:buffer";

export interface HkdfFixture {
  readonly hash: "SHA-1" | "SHA-256";
  readonly key: Uint8Array;
  readonly salt: Uint8Array;
  readonly info: Uint8Array;
  readonly length: number;
  readonly output: Uint8Array;
}

export interface Pbkdf2Fixture {
  readonly hash: "SHA-1";
  readonly key: Uint8Array;
  readonly salt: Uint8Array;
  readonly iterations: number;
  readonly length: number;
  readonly output: Uint8Array;
}

const longKey = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" +
  "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f";
const longSalt = "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f" +
  "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeaf";
const longInfo = "b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecf" +
  "d0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff";

const hkdf = [
  {
    hash: "SHA-256", key: "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
    salt: "000102030405060708090a0b0c", info: "f0f1f2f3f4f5f6f7f8f9", length: 42,
    output: "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
  },
  {
    hash: "SHA-256", key: longKey, salt: longSalt, info: longInfo, length: 82,
    output: "b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c59045a99cac7827271cb41c65e590e09" +
      "da3275600c2f09b8367793a9aca3db71cc30c58179ec3e87c14c01d5c1f3434f1d87",
  },
  {
    hash: "SHA-256", key: "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b", salt: "", info: "", length: 42,
    output: "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8",
  },
  {
    hash: "SHA-1", key: "0b0b0b0b0b0b0b0b0b0b0b", salt: "000102030405060708090a0b0c", info: "f0f1f2f3f4f5f6f7f8f9", length: 42,
    output: "085a01ea1b10f36933068b56efa5ad81a4f14b822f5b091568a9cdd4f155fda2c22e422478d305f3f896",
  },
  {
    hash: "SHA-1", key: longKey, salt: longSalt, info: longInfo, length: 82,
    output: "0bd770a74d1160f7c9f12cd5912a06ebff6adcae899d92191fe4305673ba2ffe8fa3f1a4e5ad79f3f334b3b202b2173c" +
      "486ea37ce3d397ed034c7f9dfeb15c5e927336d0441f4c4300e2cff0d0900b52d3b4",
  },
  {
    hash: "SHA-1", key: "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b", salt: "", info: "", length: 42,
    output: "0ac1af7002b3d761d1e55298da9d0506b9ae52057220a306e07b6b87e8df21d0ea00033de03984d34918",
  },
  {
    hash: "SHA-1", key: "0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c",
    salt: "0000000000000000000000000000000000000000", info: "", length: 42,
    output: "2c91117204d745f3500d636a62f64f0ab3bae548aa53d423b0d1f27ebba6f5e5673a081d70cce7acfc48",
  },
] as const;

const pbkdf2 = [
  { key: "password", salt: "salt", iterations: 1, length: 20, output: "0c60c80f961f0e71f3a9b524af6012062fe037a6" },
  { key: "password", salt: "salt", iterations: 2, length: 20, output: "ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957" },
  { key: "password", salt: "salt", iterations: 4096, length: 20, output: "4b007901b765489abead49d926f721d065a429c1" },
  {
    key: "passwordPASSWORDpassword", salt: "saltSALTsaltSALTsaltSALTsaltSALTsalt", iterations: 4096, length: 25,
    output: "3d2eec4fe41c849b80c8d83662c0e44a8b291a964cf2f07038",
  },
  { key: "pass\0word", salt: "sa\0lt", iterations: 4096, length: 16, output: "56fa6aa75548099dcc37d7f03425e0c3" },
] as const;

function bytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

export function hkdfFixture(index = 0): HkdfFixture {
  const fixture = hkdf[index];
  if (fixture === undefined) throw new RangeError("Unknown RFC 5869 fixture");
  return {
    hash: fixture.hash, key: bytes(fixture.key), salt: bytes(fixture.salt), info: bytes(fixture.info),
    length: fixture.length, output: bytes(fixture.output),
  };
}

export function pbkdf2Fixture(index = 0): Pbkdf2Fixture {
  const fixture = pbkdf2[index];
  if (fixture === undefined) throw new RangeError("Unknown RFC 6070 fixture");
  return {
    hash: "SHA-1", key: new Uint8Array(Buffer.from(fixture.key, "ascii")), salt: new Uint8Array(Buffer.from(fixture.salt, "ascii")),
    iterations: fixture.iterations, length: fixture.length, output: bytes(fixture.output),
  };
}
