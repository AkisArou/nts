/**
 * Fixed Ed25519 answers from RFC 8032 §7.1, and X25519 answers from
 * RFC 7748 §§5.2 and 6.1. No fixture is computed with the implementation under test.
 * https://www.rfc-editor.org/rfc/rfc8032.html#section-7.1
 * https://www.rfc-editor.org/rfc/rfc7748.html#section-5.2
 * https://www.rfc-editor.org/rfc/rfc7748.html#section-6.1
 *
 * Ed25519 indices 0–4 are TEST 1, TEST 2, TEST 3, TEST 1024 and TEST SHA(abc):
 * messages contain 0, 1, 2, 1023 and 64 octets, respectively. The last is plain
 * Ed25519 over the specified 64-octet message, not the Ed25519ph variant.
 * DER fixtures use the RFC 8410 §4/§7 envelopes with absent algorithm parameters.
 * Public accessors return fresh bytes or dictionaries.
 *
 * Portions Copyright (c) 2016 and 2017 IETF Trust and the persons identified as
 * authors of RFC 7748 and RFC 8032. All rights reserved.
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

export type OkpFixtureName = "Ed25519" | "X25519";

export interface OkpFixturePublicJwk {
  kty: "OKP";
  crv: OkpFixtureName;
  x: string;
}

export interface OkpFixturePrivateJwk extends OkpFixturePublicJwk {
  d: string;
}

interface Ed25519Fixture {
  readonly d: string;
  readonly x: string;
  readonly message: string;
  readonly signature: string;
}

const ed25519: readonly Ed25519Fixture[] = [
  {
    d: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    x: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    message: "",
    signature: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24" +
      "655141438e7a100b",
  },
  {
    d: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
    x: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
    message: "72",
    signature: "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aee" +
      "b00d291612bb0c00",
  },
  {
    d: "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
    x: "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
    message: "af82",
    signature: "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28d" +
      "c027beceea1ec40a",
  },
  {
    d: "f5e5767cf153319517630f226876b86c8160cc583bc013744c6bf255f5cc0ee5",
    x: "278117fc144c72340f67d0f2316e8386ceffbf2b2428c9c51fef7c597f1d426e",
    message: "08b8b2b733424243760fe426a4b54908632110a66c2f6591eabd3345e3e4eb98fa6e264bf09efe12ee50f8f54e9f77b1e355f6c50544e23f" +
      "b1433ddf73be84d879de7c0046dc4996d9e773f4bc9efe5738829adb26c81b37c93a1b270b20329d658675fc6ea534e0810a4432826bf58c" +
      "941efb65d57a338bbd2e26640f89ffbc1a858efcb8550ee3a5e1998bd177e93a7363c344fe6b199ee5d02e82d522c4feba15452f80288a82" +
      "1a579116ec6dad2b3b310da903401aa62100ab5d1a36553e06203b33890cc9b832f79ef80560ccb9a39ce767967ed628c6ad573cb116dbef" +
      "efd75499da96bd68a8a97b928a8bbc103b6621fcde2beca1231d206be6cd9ec7aff6f6c94fcd7204ed3455c68c83f4a41da4af2b74ef5c53" +
      "f1d8ac70bdcb7ed185ce81bd84359d44254d95629e9855a94a7c1958d1f8ada5d0532ed8a5aa3fb2d17ba70eb6248e594e1a2297acbbb39d" +
      "502f1a8c6eb6f1ce22b3de1a1f40cc24554119a831a9aad6079cad88425de6bde1a9187ebb6092cf67bf2b13fd65f27088d78b7e883c8759" +
      "d2c4f5c65adb7553878ad575f9fad878e80a0c9ba63bcbcc2732e69485bbc9c90bfbd62481d9089beccf80cfe2df16a2cf65bd92dd597b07" +
      "07e0917af48bbb75fed413d238f5555a7a569d80c3414a8d0859dc65a46128bab27af87a71314f318c782b23ebfe808b82b0ce26401d2e22" +
      "f04d83d1255dc51addd3b75a2b1ae0784504df543af8969be3ea7082ff7fc9888c144da2af58429ec96031dbcad3dad9af0dcbaaaf268cb8" +
      "fcffead94f3c7ca495e056a9b47acdb751fb73e666c6c655ade8297297d07ad1ba5e43f1bca32301651339e22904cc8c42f58c30c04aafdb" +
      "038dda0847dd988dcda6f3bfd15c4b4c4525004aa06eeff8ca61783aacec57fb3d1f92b0fe2fd1a85f6724517b65e614ad6808d6f6ee34df" +
      "f7310fdc82aebfd904b01e1dc54b2927094b2db68d6f903b68401adebf5a7e08d78ff4ef5d63653a65040cf9bfd4aca7984a74d371459867" +
      "80fc0b16ac451649de6188a7dbdf191f64b5fc5e2ab47b57f7f7276cd419c17a3ca8e1b939ae49e488acba6b965610b5480109c8b17b80e1" +
      "b7b750dfc7598d5d5011fd2dcc5600a32ef5b52a1ecc820e308aa342721aac0943bf6686b64b2579376504ccc493d97e6aed3fb0f9cd71a4" +
      "3dd497f01f17c0e2cb3797aa2a2f256656168e6c496afc5fb93246f6b1116398a346f1a641f3b041e989f7914f90cc2c7fff357876e506b5" +
      "0d334ba77c225bc307ba537152f3f1610e4eafe595f6d9d90d11faa933a15ef1369546868a7f3a45a96768d40fd9d03412c091c6315cf4fd" +
      "e7cb68606937380db2eaaa707b4c4185c32eddcdd306705e4dc1ffc872eeee475a64dfac86aba41c0618983f8741c5ef68d3a101e8a3b8ca" +
      "c60c905c15fc910840b94c00a0b9d0",
    signature: "0aab4c900501b3e24d7cdf4663326a3a87df5e4843b2cbdb67cbf6e460fec350aa5371b1508f9f4528ecea23c436d94b5e8fcd4f681e30a6" +
      "ac00a9704a188a03",
  },
  {
    d: "833fe62409237b9d62ec77587520911e9a759cec1d19755b7da901b96dca3d42",
    x: "ec172b93ad5e563bf4932c70e1245034c35467ef2efd4d64ebf819683467e2bf",
    message: "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e" +
      "2a9ac94fa54ca49f",
    signature: "dc2a4459e7369633a52b1bf277839a00201009a3efbf3ecb69bea2186c26b58909351fc9ac90b3ecfdfbc7c66431e0303dca179c138ac17a" +
      "d9bef1177331a704",
  },
];

interface X25519Peer {
  readonly d: string;
  readonly x: string;
}

const peers: Readonly<Record<"alice" | "bob", X25519Peer>> = {
  alice: {
    d: "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
    x: "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a",
  },
  bob: {
    d: "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",
    x: "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f",
  },
};

interface ScalarHexVector {
  readonly scalar: string;
  readonly publicKey: string;
  readonly secret: string;
}

const scalarVectors: readonly ScalarHexVector[] = [
  {
    scalar: "a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4",
    publicKey: "e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c",
    secret: "c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552",
  },
  {
    scalar: "4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d",
    publicKey: "e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493",
    secret: "95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957",
  },
];

function bytes(hex: string): Uint8Array { return new Uint8Array(Buffer.from(hex, "hex")); }
function base64url(hex: string): string { return Buffer.from(hex, "hex").toString("base64url"); }

function ed25519Fixture(index: number): Ed25519Fixture {
  const fixture = ed25519[index];
  if (fixture === undefined) throw new RangeError("Unknown Ed25519 fixture");
  return fixture;
}

export function ed25519PublicJwk(index = 0): OkpFixturePublicJwk {
  return { kty: "OKP", crv: "Ed25519", x: base64url(ed25519Fixture(index).x) };
}

export function ed25519PrivateJwk(index = 0): OkpFixturePrivateJwk {
  return { ...ed25519PublicJwk(index), d: base64url(ed25519Fixture(index).d) };
}

export function ed25519Message(index = 0): Uint8Array { return bytes(ed25519Fixture(index).message); }
export function ed25519Signature(index = 0): Uint8Array { return bytes(ed25519Fixture(index).signature); }

export function x25519PublicJwk(side: "alice" | "bob" = "alice"): OkpFixturePublicJwk {
  return { kty: "OKP", crv: "X25519", x: base64url(peers[side].x) };
}

export function x25519PrivateJwk(side: "alice" | "bob" = "alice"): OkpFixturePrivateJwk {
  return { ...x25519PublicJwk(side), d: base64url(peers[side].d) };
}

export function x25519Secret(): Uint8Array {
  return bytes("4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742");
}

export function x25519ScalarVector(index: 0 | 1): { scalar: Uint8Array; publicKey: Uint8Array; secret: Uint8Array } {
  const vector = scalarVectors[index]!;
  return { scalar: bytes(vector.scalar), publicKey: bytes(vector.publicKey), secret: bytes(vector.secret) };
}

export function okpPublicJwk(name: OkpFixtureName): OkpFixturePublicJwk {
  return name === "Ed25519" ? ed25519PublicJwk() : x25519PublicJwk();
}

export function okpPrivateJwk(name: OkpFixtureName): OkpFixturePrivateJwk {
  return name === "Ed25519" ? ed25519PrivateJwk() : x25519PrivateJwk();
}

export function okpRawPublic(name: OkpFixtureName): Uint8Array {
  return new Uint8Array(Buffer.from(okpPublicJwk(name).x, "base64url"));
}

export function okpSpki(name: OkpFixtureName): Uint8Array {
  const oid = name === "Ed25519" ? "70" : "6e";
  const x = Buffer.from(okpPublicJwk(name).x, "base64url").toString("hex");
  return bytes("302a300506032b65" + oid + "032100" + x);
}

export function okpPkcs8(name: OkpFixtureName): Uint8Array {
  const oid = name === "Ed25519" ? "70" : "6e";
  const d = Buffer.from(okpPrivateJwk(name).d, "base64url").toString("hex");
  return bytes("302e020100300506032b65" + oid + "04220420" + d);
}
