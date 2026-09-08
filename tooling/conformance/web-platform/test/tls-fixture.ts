// @ts-nocheck -- converted from `.mjs` and not yet typed.
//
// This file was JavaScript until the suite moved to running TypeScript source directly,
// and it was never type-checked. The pragma says so out loud rather than leaving the
// `.ts` extension to imply a guarantee that does not hold. Removing it is a per-file
// job: `grep -lc "@ts-nocheck" test/*.ts` is the remaining list.
// Private test certificate generated in a temporary directory, never trusted globally.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
let fixture;
export function tlsFixture() {
  if (fixture) return fixture;
  const dir = mkdtempSync(join(tmpdir(), "nts-web-tls-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-sha256",
        "-days",
        "2",
        "-subj",
        "/CN=NTS test only",
        "-addext",
        "subjectAltName=IP:127.0.0.1,DNS:target.test",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
    fixture = {
      key: readFileSync(join(dir, "key.pem")),
      cert: readFileSync(join(dir, "cert.pem")),
    };
    return fixture;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const named = new Map();

/**
 * A private certificate presenting exactly the given subjectAltName entries.
 *
 * Connection reuse decisions read dNSName SANs, so a test that exercises them needs a
 * certificate covering more than one name. Entries are passed through verbatim, for
 * example `"DNS:alpha.test"` or `"IP:127.0.0.1"`.
 */
export function tlsFixtureFor(entries) {
  const subjectAltName = entries.join(",");
  const cached = named.get(subjectAltName);
  if (cached) return cached;
  const dir = mkdtempSync(join(tmpdir(), "nts-web-tls-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-sha256",
        "-days",
        "2",
        "-subj",
        "/CN=NTS test only",
        "-addext",
        "subjectAltName=" + subjectAltName,
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
    const created = {
      key: readFileSync(join(dir, "key.pem")),
      cert: readFileSync(join(dir, "cert.pem")),
    };
    named.set(subjectAltName, created);
    return created;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
