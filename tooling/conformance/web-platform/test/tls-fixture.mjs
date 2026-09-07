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
