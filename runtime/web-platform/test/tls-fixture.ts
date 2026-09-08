// Private test certificate generated in a temporary directory, never trusted globally.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/** A key and certificate in PEM, as `node:tls` wants them. */
export interface TlsFixture {
  readonly key: Buffer;
  readonly cert: Buffer;
}

let fixture: TlsFixture | undefined;
export function tlsFixture(): TlsFixture {
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

const named = new Map<string, TlsFixture>();

/**
 * A private certificate presenting exactly the given subjectAltName entries.
 *
 * Connection reuse decisions read dNSName SANs, so a test that exercises them needs a
 * certificate covering more than one name. Entries are passed through verbatim, for
 * example `"DNS:alpha.test"` or `"IP:127.0.0.1"`.
 */
export function tlsFixtureFor(entries: readonly string[]): TlsFixture {
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
