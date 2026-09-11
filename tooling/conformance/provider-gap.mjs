// How much of node's crypto and tls corpus a candidate TLS provider cannot reach.
//
//   node tooling/conformance/provider-gap.mjs
//
// # Why a count and not a reading of the documentation
//
// The provider choice -- OpenSSL, which node uses, against mbedTLS, which is a
// fraction of the size -- kept being argued from impressions of what each library
// supports. Two numbers settle more of it than any amount of that. One was already
// measured: 27 of 218 `test-tls-*` and 29 of 128 `test-crypto-*` assert something
// OpenSSL-specific, which is the cost of *leaving* OpenSSL. This is the other
// half: what a smaller provider could not do at all.
//
// # The tiers are the whole point
//
// "mbedTLS lacks X" splits into two claims that deserve different weight:
//
//   A PRIMITIVE IT DOES NOT SHIP -- no amount of wrapper code produces scrypt, a
//   JWK codec, Ed448 or ML-KEM from a library that has none of them. These are
//   the files that would simply not pass.
//
//   A SURFACE IT DOES NOT PRESENT -- mbedTLS generates RSA and EC keys and writes
//   PEM and DER through `pk_write`, so `generateKeyPair` is work rather than an
//   obstacle. Same for the `KeyObject` abstraction, `DiffieHellman` and
//   `X509Certificate`. Counting these as gaps was the first draft's error and
//   inflated the answer by a factor of three.
//
// # What this cannot tell you, and the honest shape of it
//
// A file matching `'jwk'` is a file that would need a JWK codec; it is not proof
// the file fails today, because nothing here runs anything. It measures reach of
// an API family across a corpus, which is the question the provider decision
// turns on, and stops there.
//
// It also says nothing about mbedTLS's actual feature list, which is not on this
// machine -- the families are named from the decision that prompted it. If that
// list is wrong the counts are wrong with it, which is why each family is spelled
// out separately rather than summed into one number.
//
// # `test-webcrypto-*` is a population the usual figure omits
//
// "crypto's 128" means `test-crypto-*`. There are 47 more files named
// `test-webcrypto-*`, and 43 of them need something in the hard tier. Any figure
// quoted as a fraction of 128 has already excluded them.

import { readdirSync, readFileSync } from "node:fs";

const dir = "third_party/node/test/parallel";

const hard = {
  "JWK codec":             /['"]jwk['"]/,
  "WebCrypto":             /\bwebcrypto\b|crypto\.subtle|\bsubtle\s*\./,
  "scrypt":                /\bscrypt(Sync)?\s*\(/,
  "EdDSA (ed25519/ed448)": /\bed(25519|448)\b/i,
  "PQC (ML-KEM/ML-DSA/SLH-DSA)": /\b(ml[-_]?kem|ml[-_]?dsa|slh[-_]?dsa)\b/i,
};

const soft = {
  "generateKeyPair (PEM/DER)": /\bgenerateKeyPair(Sync)?\s*\(/,
  "KeyObject abstraction":     /\b(createPrivateKey|createPublicKey|createSecretKey)\s*\(|\bKeyObject\b/,
  "DiffieHellman / ECDH":      /\b(createDiffieHellman|createDiffieHellmanGroup|getDiffieHellman|createECDH|diffieHellman)\s*\(|\bDiffieHellman(Group)?\b|\bECDH\b/,
  "X509Certificate":           /\bX509Certificate\b/,
  "ChaCha20-Poly1305":         /chacha20/i,
};

const load = (prefix) =>
  readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".js"))
    .map((f) => [f, readFileSync(`${dir}/${f}`, "utf8")]);

let total = 0;
for (const prefix of ["test-crypto-", "test-webcrypto-", "test-tls-"]) {
  const files = load(prefix);
  total += files.length;
  console.log(`\n  ${prefix}*.js -- ${files.length} file(s)`);

  const hardSet = new Set();
  console.log("    a primitive mbedTLS does not ship:");
  for (const [label, re] of Object.entries(hard)) {
    const hits = files.filter(([, t]) => re.test(t));
    hits.forEach(([f]) => hardSet.add(f));
    console.log(`      ${String(hits.length).padStart(3)}  ${label}`);
  }

  const softSet = new Set();
  console.log("    a surface it does not present, over primitives it has:");
  for (const [label, re] of Object.entries(soft)) {
    const hits = files.filter(([, t]) => re.test(t));
    hits.forEach(([f]) => softSet.add(f));
    console.log(`      ${String(hits.length).padStart(3)}  ${label}`);
  }

  const softOnly = [...softSet].filter((f) => !hardSet.has(f));
  const pct = (n) => `${((n / files.length) * 100).toFixed(0)}%`.padStart(4);
  console.log(`      ${String(hardSet.size).padStart(3)} ${pct(hardSet.size)}  UNION, hard`);
  console.log(`      ${String(softOnly.length).padStart(3)} ${pct(softOnly.length)}  surface only`);
  console.log(`      ${String(files.length - hardSet.size - softOnly.length).padStart(3)} ${pct(files.length - hardSet.size - softOnly.length)}  neither`);
}

console.log(`\n  ${total} file(s) read across three prefixes. Nothing was executed:`);
console.log("  every number above is an API family's reach across a corpus.");
