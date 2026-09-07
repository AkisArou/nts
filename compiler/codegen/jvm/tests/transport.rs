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

/// The runtime jar, copied somewhere this process owns.
///
/// Three sessions share this checkout and `runtime_jar.rs` rewrites
/// `runtime/jvm/nts-runtime.jar` **in place**, so a driver that reads the
/// checked-in path directly can be handed a half-written archive. That fails as
/// a `ZipException` or a missing class, in whichever suite happened to be
/// running at the moment, and it looks exactly like the thing under test being
/// broken -- which cost another session a run before the cause was found.
///
/// Copied once per test binary, so the artifact is immutable for the run.
/// `OnceLock` rather than an `exists` check because cargo runs these in
/// parallel threads and two of them racing on the same destination is the same
/// half-written file one layer down.
fn runtime_jar() -> PathBuf {
    static JAR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    JAR.get_or_init(|| {
        let source = std::env::var_os("NTS_JVM_RUNTIME_JAR")
            .map_or_else(|| repository().join("runtime/jvm/nts-runtime.jar"), PathBuf::from);
        let mine = std::env::temp_dir().join(format!("nts-runtime-{}.jar", std::process::id()));
        if std::fs::copy(&source, &mine).is_ok() { mine } else { source }
    })
    .clone()
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

fn jar() -> PathBuf { runtime_jar() }

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
        // The **count**, not only the zero. A suite that stopped running half its
    // cases reports no failures perfectly well, which is the assertion
    // `android.rs` already makes about `PASS: 11` and the one every other
    // driver here was missing.
    assert!(said.ends_with("56 checks, 0 failures"), "{said}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// The worker queue's bound, reached.
///
/// `NtsSocket.submit` catches `RejectedExecutionException` and says of it "the
/// queue is bounded, so this is reachable" -- a claim nothing executed. The
/// pool is 8 workers over a 256-deep queue, so it takes 265 operations in
/// flight and nothing in this lane had asked for more than a handful.
///
/// The driver asserts the arithmetic rather than the fact: exactly 264 reads
/// are admitted and the rest refused. "Something was refused" would pass
/// against a pool of one, and the number is the whole claim -- it is what says
/// an application on a phone cannot be made to spawn a thread per connect.
#[test]
fn a_full_io_queue_refuses_at_submission_and_gives_the_credit_back() {
    let (Some(javac), Some(java)) = (tool("javac"), tool("java")) else { return };
    let jar = jar();
    let dir = std::env::temp_dir().join(format!("nts-saturate-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    compile(&javac, &jar, &dir, "SaturateTest");
    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(format!("{}:{}", jar.display(), dir.display()))
        .arg("SaturateTest")
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).trim().to_owned();
    assert!(
        ran.status.success(),
        "the saturation test failed:\n{said}\n{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    assert!(said.ends_with("417 checks, 0 failures"), "{said}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// A self-signed certificate naming `localhost`, and a trust store holding it.
///
/// Generated per run rather than checked in: a certificate in a repository is a
/// secret that is not one, and a two-day validity that expired would be a
/// failure nobody could attribute.
///
/// `localhost` and not `127.0.0.1` is the whole design. Both tests that use
/// this connect to `127.0.0.1` and ask for one name or the other, so the
/// certificate discriminates between two connections that are otherwise
/// identical -- and through a proxy it also discriminates between verifying
/// the target and verifying the proxy, which is the same distinction one hop
/// further out.
fn keystores(keytool: &Path, dir: &Path) -> (PathBuf, PathBuf) {
    let server = dir.join("server.p12");
    let cert = dir.join("nts.cer");
    let trust = dir.join("trust.p12");
    let made = Command::new(keytool)
        .args(["-genkeypair", "-alias", "nts", "-keyalg", "RSA", "-keysize", "2048"])
        .args(["-validity", "1", "-dname", "CN=nts-test", "-ext", "SAN=dns:localhost"])
        .arg("-keystore")
        .arg(&server)
        .args(["-storetype", "PKCS12", "-storepass", "changeit", "-keypass", "changeit"])
        .output()
        .unwrap();
    assert!(made.status.success(), "keytool: {}", String::from_utf8_lossy(&made.stderr));
    let exported = Command::new(keytool)
        .args(["-exportcert", "-alias", "nts", "-storetype", "PKCS12", "-storepass", "changeit"])
        .arg("-keystore")
        .arg(&server)
        .arg("-file")
        .arg(&cert)
        .output()
        .unwrap();
    assert!(exported.status.success(), "keytool: {}", String::from_utf8_lossy(&exported.stderr));
    let imported = Command::new(keytool)
        .args(["-importcert", "-noprompt", "-alias", "nts", "-storetype", "PKCS12"])
        .args(["-storepass", "changeit"])
        .arg("-file")
        .arg(&cert)
        .arg("-keystore")
        .arg(&trust)
        .output()
        .unwrap();
    assert!(imported.status.success(), "keytool: {}", String::from_utf8_lossy(&imported.stderr));
    (server, trust)
}

/// An HTTP `CONNECT` tunnel, a SOCKS5 hop, and the certificate check a tunnel
/// is most likely to lose.
///
/// The proxy is on `127.0.0.1` and the certificate names `localhost`, so a
/// tunnel to `localhost` must succeed and one to `127.0.0.1` must fail. An
/// implementation that verified against the *proxy* inverts the first of those
/// -- the sabotage reports `No subject alternative names matching IP address
/// 127.0.0.1`, which is the proxy's address arriving where the target's name
/// should be.
#[test]
fn a_tunnel_carries_bytes_and_keeps_the_targets_name() {
    let (Some(javac), Some(java), Some(keytool)) = (tool("javac"), tool("java"), tool("keytool"))
    else {
        return;
    };
    let jar = jar();
    let dir = std::env::temp_dir().join(format!("nts-proxy-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (server, trust) = keystores(&keytool, &dir);
    compile(&javac, &jar, &dir, "ProxyTest");
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
        .arg("ProxyTest")
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).trim().to_owned();
    assert!(
        ran.status.success(),
        "{said}\n{}",
        String::from_utf8_lossy(&ran.stderr)
    );
        // The **count**, not only the zero. A suite that stopped running half its
    // cases reports no failures perfectly well, which is the assertion
    // `android.rs` already makes about `PASS: 11` and the one every other
    // driver here was missing.
    assert!(said.ends_with("23 checks, 0 failures"), "{said}");
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
    let (server, trust) = keystores(&keytool, &dir);


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
        // The **count**, not only the zero. A suite that stopped running half its
    // cases reports no failures perfectly well, which is the assertion
    // `android.rs` already makes about `PASS: 11` and the one every other
    // driver here was missing.
    assert!(said.ends_with("2 checks, 0 failures"), "{said}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// The pieces composed, and the observable the production adapter must match.
///
/// Each part is tested alone above. This proves they hold together: a response
/// dribbled seven bytes at a time, decoded by a state machine that never sees a
/// whole frame, with every completion crossing the inbox.
///
/// And it records what the **reference** adapter exposes. A platform HTTP client
/// that decompresses transparently strips `Content-Encoding` and rewrites
/// `Content-Length` while doing it, so the same response yields different
/// observable headers depending on which adapter fetched it. The reference
/// hands back the wire headers unchanged; the `OkHttp` adapter has to produce the
/// same pair, and that cross-adapter assertion is what this half sets up.
#[test]
fn a_gzip_response_survives_the_socket_and_keeps_its_headers() {
    let (Some(javac), Some(java)) = (tool("javac"), tool("java")) else { return };
    let jar = jar();
    let dir = std::env::temp_dir().join(format!("nts-httpgzip-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    compile(&javac, &jar, &dir, "HttpGzipTest");
    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(format!("{}:{}", jar.display(), dir.display()))
        .arg("HttpGzipTest")
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).trim().to_owned();
    assert!(
        ran.status.success(),
        "the HTTP/gzip integration failed:\n{said}\n{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    assert!(said.ends_with("6 checks, 0 failures"), "{said}");
    let _ = std::fs::remove_dir_all(&dir);
}
