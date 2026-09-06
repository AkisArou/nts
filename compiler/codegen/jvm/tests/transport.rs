//! The reference transport: bytes, lanes, cancellation, backpressure, and TLS.
//!
//! # Real I/O, so these are liveness tests rather than oracle tests
//!
//! Everything here talks to a loopback server on a **monotonic** environment.
//! Nothing is compared against node, because nothing here is deterministic:
//! what is proved is that completions reach the owner lane, that a cancelled
//! operation settles exactly once, that a refused launch creates no socket, and
//! that TLS checks the name as well as the chain.
//!
//! # Why the TLS test is a pair
//!
//! An `SSLSocket` validates the certificate chain and **does not** check that
//! the certificate belongs to the host asked for. Endpoint identification is
//! off by default, so a valid certificate for any host any trusted CA signed is
//! accepted for every host — against an honest server, silently, forever.
//!
//! One failing connection would not prove the check works; it could fail for
//! any reason. So a certificate is generated with `SAN=dns:localhost`, the
//! client is pointed at a trust store containing it — chain validation cannot
//! be what refuses — and two connections are made that differ **only in the
//! name**. `localhost` must succeed and `127.0.0.1` must fail. Removing
//! `setEndpointIdentificationAlgorithm` from `NtsSocket` makes the second
//! succeed, which is how this was verified to be able to fail.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::process::Command;

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn tool(name: &str) -> Option<PathBuf> {
    if let Ok(home) = std::env::var("JAVA_HOME") {
        let path = PathBuf::from(home).join("bin").join(name);
        if path.exists() {
            return Some(path);
        }
    }
    let found = Command::new("sh").arg("-c").arg(format!("command -v {name}")).output().ok()?;
    found
        .status
        .success()
        .then(|| PathBuf::from(String::from_utf8_lossy(&found.stdout).trim().to_owned()))
}

fn compile(javac: &Path, jar: &Path, dir: &Path, driver: &str) {
    let source = repository().join(format!("compiler/codegen/jvm/tests/socket/{driver}.java"));
    let compiled = Command::new(javac)
        .arg("--release")
        .arg("8")
        .arg("-Xlint:-options")
        .arg("-cp")
        .arg(jar)
        .arg("-d")
        .arg(dir)
        .arg(&source)
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "the {driver} driver did not compile:\n{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
}

fn jar() -> PathBuf {
    std::env::var_os("NTS_JVM_RUNTIME_JAR")
        .map_or_else(|| repository().join("runtime/jvm/nts-runtime.jar"), PathBuf::from)
}

#[test]
fn the_reference_transport_delivers_on_the_owner_lane() {
    let (Some(javac), Some(java)) = (tool("javac"), tool("java")) else { return };
    let jar = jar();
    let dir = std::env::temp_dir().join(format!("nts-socket-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    compile(&javac, &jar, &dir, "SocketTest");
    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(format!("{}:{}", jar.display(), dir.display()))
        .arg("SocketTest")
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).trim().to_owned();
    assert!(
        ran.status.success(),
        "the transport test failed:\n{said}\n{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    assert!(said.ends_with("0 failures"), "{said}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn tls_refuses_a_certificate_that_names_another_host() {
    let (Some(javac), Some(java), Some(keytool)) = (tool("javac"), tool("java"), tool("keytool"))
    else {
        return;
    };
    let jar = jar();
    let dir = std::env::temp_dir().join(format!("nts-tls-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let server = dir.join("server.p12");
    let cert = dir.join("nts.cer");
    let trust = dir.join("trust.p12");

    // Generated per run rather than checked in: a certificate in a repository
    // is a secret that is not one, and a two-day validity that expired would be
    // a failure nobody could attribute.
    let made = Command::new(&keytool)
        .args(["-genkeypair", "-alias", "nts", "-keyalg", "RSA", "-keysize", "2048"])
        .args(["-validity", "1", "-dname", "CN=nts-test", "-ext", "SAN=dns:localhost"])
        .arg("-keystore")
        .arg(&server)
        .args(["-storetype", "PKCS12", "-storepass", "changeit", "-keypass", "changeit"])
        .output()
        .unwrap();
    assert!(made.status.success(), "keytool: {}", String::from_utf8_lossy(&made.stderr));
    let exported = Command::new(&keytool)
        .args(["-exportcert", "-alias", "nts", "-storetype", "PKCS12", "-storepass", "changeit"])
        .arg("-keystore")
        .arg(&server)
        .arg("-file")
        .arg(&cert)
        .output()
        .unwrap();
    assert!(exported.status.success(), "keytool: {}", String::from_utf8_lossy(&exported.stderr));
    let imported = Command::new(&keytool)
        .args(["-importcert", "-noprompt", "-alias", "nts", "-storetype", "PKCS12"])
        .args(["-storepass", "changeit"])
        .arg("-file")
        .arg(&cert)
        .arg("-keystore")
        .arg(&trust)
        .output()
        .unwrap();
    assert!(imported.status.success(), "keytool: {}", String::from_utf8_lossy(&imported.stderr));

    compile(&javac, &jar, &dir, "TlsTest");
    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg(format!("-Djavax.net.ssl.keyStore={}", server.display()))
        .arg("-Djavax.net.ssl.keyStorePassword=changeit")
        .arg("-Djavax.net.ssl.keyStoreType=PKCS12")
        .arg(format!("-Djavax.net.ssl.trustStore={}", trust.display()))
        .arg("-Djavax.net.ssl.trustStorePassword=changeit")
        .arg("-Djavax.net.ssl.trustStoreType=PKCS12")
        .arg("-cp")
        .arg(format!("{}:{}", jar.display(), dir.display()))
        .arg("TlsTest")
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).trim().to_owned();
    assert!(
        ran.status.success(),
        "the TLS test failed:\n{said}\n{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    assert!(said.ends_with("0 failures"), "{said}");
    let _ = std::fs::remove_dir_all(&dir);
}
