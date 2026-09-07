//! The Android networking primitives, built and run where there is no Android.
//!
//! # Why this runs on a desktop JVM at all
//!
//! `src/main` is deliberately free of `android.*`: the whole SDK dependency is
//! one method in `src/android/java/.../AndroidNetworking.java`, which asks
//! `NetworkSecurityPolicy` whether cleartext is permitted and passes the answer
//! in as a `CleartextPolicy`. Everything else is `java.net` and `javax.net.ssl`,
//! which a desktop JVM has.
//!
//! That is not an accident of style and it is the reason there is evidence
//! here rather than a note saying a device would be needed. Real sockets, real
//! TLS, real handshake failures, on every machine that can run the rest of the
//! suite. What a device is still needed for is named where it is needed: the
//! `NetworkSecurityPolicy` call itself, D8/R8 output, and ARM publication
//! ordering.
//!
//! # The certificate names an address, and the other TLS suite names a host
//!
//! `transport.rs` generates `SAN=dns:localhost` and connects to `127.0.0.1`,
//! so asking for `localhost` succeeds and asking for the address fails. This
//! one is the mirror -- `SAN=ip:127.0.0.1` -- because its suite connects to the
//! address and expects `localhost` to be refused. Two certificates rather than
//! one shared fixture, because a suite that shares its oracle with the thing it
//! is checking has fewer independent facts in it than it appears to.

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

fn android() -> PathBuf {
    repository().join("runtime/web-platform/android")
}

/// Every `.java` under a directory, since the suite is small enough that
/// listing files by hand would be a second answer to "what is in it".
fn sources(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(at) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&at) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|it| it == "java") {
                found.push(path);
            }
        }
    }
    found.sort();
    found
}

/// Compile `src/main` and `src/test` into `dir`. `src/android` is left out --
/// it is the one file that needs the SDK.
fn build(javac: &Path, dir: &Path) -> Result<(), String> {
    let mut compile = Command::new(javac);
    compile.args(["--release", "8", "-Xlint:all,-options", "-Werror", "-d"]).arg(dir);
    for path in sources(&android().join("src/main")) {
        compile.arg(path);
    }
    for path in sources(&android().join("src/test")) {
        compile.arg(path);
    }
    let built = compile.output().unwrap();
    if built.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&built.stderr).into_owned())
    }
}

#[test]
fn the_primitives_pass_their_own_suite_against_real_sockets_and_tls() {
    let (Some(javac), Some(java), Some(keytool)) = (tool("javac"), tool("java"), tool("keytool"))
    else {
        return;
    };
    let dir = std::env::temp_dir().join(format!("nts-android-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    build(&javac, &dir).unwrap_or_else(|error| panic!("the Android primitives did not compile:\n{error}"));

    let store = dir.join("store.p12");
    let made = Command::new(&keytool)
        .args(["-genkeypair", "-alias", "nts-web", "-keyalg", "RSA", "-keysize", "2048"])
        .args(["-validity", "1", "-dname", "CN=nts-web-test", "-ext", "SAN=ip:127.0.0.1"])
        .arg("-keystore")
        .arg(&store)
        .args(["-storetype", "PKCS12", "-storepass", "test-only", "-keypass", "test-only"])
        .output()
        .unwrap();
    assert!(made.status.success(), "keytool: {}", String::from_utf8_lossy(&made.stderr));

    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(&dir)
        .arg("org.nts.web.NetworkPrimitivesTest")
        .arg(&store)
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).trim().to_owned();
    assert!(
        ran.status.success(),
        "{said}\n{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    // The count is part of the assertion. A suite that silently stops running
    // half its cases still says `PASS`, which is record 0175 from the other
    // side, and this one reaches its TLS cases only if an argument it was
    // given parses -- so "eleven" is the claim, not "no failures".
    assert!(said.contains("PASS: 11 Java integration tests"), "{said}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// The Android SDK's `d8`, `android.jar` and a build-tools directory that has
/// both, or `None`.
fn sdk() -> Option<(PathBuf, PathBuf)> {
    let home = PathBuf::from(std::env::var_os("ANDROID_HOME").or_else(|| std::env::var_os("ANDROID_SDK_ROOT"))?);
    let platform = std::fs::read_dir(home.join("platforms")).ok()?
        .flatten()
        .map(|entry| entry.path().join("android.jar"))
        .filter(|jar| jar.exists())
        .max()?;
    let tools = std::fs::read_dir(home.join("build-tools")).ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.join("d8").exists())
        .max()?;
    Some((tools, platform))
}

/// Both artifacts survive `d8` at the API floor they claim, and neither keeps
/// an `invoke-custom` after it.
///
/// # Why the dex is where this is asked and not the class file
///
/// `runtime_jar.rs` already asserts `nts-runtime.jar` has no `invokedynamic`,
/// which is the rule that keeps the Android path open. The Android library
/// **does** have some -- it is written with lambdas -- and that is not a
/// violation of the same rule, because it is not the same artifact and not the
/// same question. The question for a library that ships through AGP is what
/// comes out of D8, and the answer is measured here rather than argued:
///
///     android library   38 classes,  222 methods, 0 invoke-custom
///     nts-runtime.jar   45 classes,  807 methods, 0 invoke-custom
///
/// D8 desugars every lambda into a class even at `--min-api 26`, where
/// `invoke-custom` would have been legal. So "free of accidental
/// invokedynamic" is true of both shipped artifacts by different routes: one
/// never has any, and the other's do not survive the toolchain.
///
/// The class *names* are checked too. A `d8` that produced an empty dex would
/// satisfy "zero invoke-custom" perfectly.
#[test]
fn both_artifacts_dex_at_api_26_with_no_invoke_custom() {
    let (Some(javac), Some((tools, platform))) = (tool("javac"), sdk()) else { return };
    let root = repository();
    let dir = std::env::temp_dir().join(format!("nts-d8-{}", std::process::id()));
    let classes = dir.join("classes");
    std::fs::create_dir_all(&classes).unwrap();

    // Compiled against `android.jar` on the *classpath* with the JDK's own
    // boot classes, which is what AGP does. Putting `android.jar` on the boot
    // classpath instead fails on `LambdaMetafactory`, which the SDK does not
    // ship because D8 is what removes the need for it.
    let mut compile = Command::new(&javac);
    compile.args(["--release", "8", "-Xlint:all,-options", "-Werror", "-cp"])
        .arg(&platform)
        .arg("-d")
        .arg(&classes);
    for path in sources(&android().join("src/main")) {
        compile.arg(path);
    }
    for path in sources(&android().join("src/android")) {
        compile.arg(path);
    }
    let built = compile.output().unwrap();
    assert!(
        built.status.success(),
        "the Android source sets did not compile against the SDK:\n{}",
        String::from_utf8_lossy(&built.stderr)
    );

    let jar = std::env::var_os("NTS_JVM_RUNTIME_JAR")
        .map_or_else(|| root.join("runtime/jvm/nts-runtime.jar"), PathBuf::from);

    for (what, out, inputs) in [
        ("the Android library", dir.join("library"), sources_of(&classes)),
        ("nts-runtime.jar", dir.join("runtime"), vec![jar.clone()]),
    ] {
        std::fs::create_dir_all(&out).unwrap();
        let mut dex = Command::new(tools.join("d8"));
        dex.args(["--min-api", "26", "--lib"]).arg(&platform).arg("--output").arg(&out);
        for input in &inputs {
            dex.arg(input);
        }
        let ran = dex.output().unwrap();
        assert!(
            ran.status.success(),
            "d8 refused {what} at API 26:\n{}",
            String::from_utf8_lossy(&ran.stderr)
        );
        let produced = out.join("classes.dex");
        assert!(produced.exists(), "d8 produced no dex for {what}");

        let dumped = Command::new(tools.join("dexdump")).arg("-d").arg(&produced).output().unwrap();
        let listing = String::from_utf8_lossy(&dumped.stdout);
        let custom = listing.matches("invoke-custom").count();
        assert_eq!(
            custom, 0,
            "{what} kept {custom} invoke-custom instruction(s) after d8 --min-api 26"
        );
        let named = listing.matches("Lnts/rt/").count() + listing.matches("Lorg/nts/web/").count();
        assert!(
            named > 0,
            "{what} dexed to something that mentions none of its own classes, so \
             the zero above is a fact about an empty file"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

/// One pinned third-party dependency: where it lives and what it must hash to.
struct Pinned {
    group: String,
    artifact: String,
    version: String,
    sha256: String,
    scope: String,
    repository: String,
}

/// The pins, read from the file that is also the SBOM.
///
/// One file rather than a build-file version and a separate hash list: a
/// version resolved in one place and hashed in another is two answers to what
/// ships, and the interesting failure is exactly when they disagree.
fn pinned() -> Vec<Pinned> {
    let text = std::fs::read_to_string(android().join("dependencies.tsv")).unwrap();
    text.lines()
        .filter(|line| !line.trim_start().starts_with('#') && !line.trim().is_empty())
        .filter_map(|line| {
            let mut fields = line.split('\t');
            let pin = Pinned {
                group: fields.next()?.to_owned(),
                artifact: fields.next()?.to_owned(),
                version: fields.next()?.to_owned(),
                sha256: fields.next()?.to_owned(),
                scope: {
                    let _license = fields.next()?;
                    fields.next()?.to_owned()
                },
                repository: fields.next()?.to_owned(),
            };
            Some(pin)
        })
        .collect()
}

// The round constants are the specification's, in the specification's spelling.
// `0x428a_2f98` is what the lint wants and is not what FIPS 180-4 prints, so a
// reader checking these against the standard would have to un-group all
// sixty-four of them first -- which is the transcription error this is meant to
// prevent, moved rather than removed.
#[allow(clippy::unreadable_literal)]
fn digest(bytes: &[u8]) -> String {
    // A local SHA-256 so the test needs no crate for it. The compression
    // function is the specification's; there is nothing to get creative about
    // and the vectors below are the check.
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut message = bytes.to_vec();
    let length = (bytes.len() as u64) * 8;
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&length.to_be_bytes());
    for block in message.chunks(64) {
        let mut w = [0u32; 64];
        for (i, word) in block.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let mut v = h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7]
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [t1.wrapping_add(t2), v[0], v[1], v[2], v[3].wrapping_add(t1), v[4], v[5], v[6]];
        }
        for i in 0..8 {
            h[i] = h[i].wrapping_add(v[i]);
        }
    }
    let mut hex = String::with_capacity(64);
    for word in h {
        use std::fmt::Write as _;
        let _ = write!(hex, "{word:08x}");
    }
    hex
}

#[test]
fn the_digest_this_test_uses_is_the_one_everyone_else_means() {
    assert_eq!(
        digest(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        digest(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    // Past one block, so the padding and the length are exercised too.
    assert_eq!(
        digest(&vec![b'a'; 1000]),
        "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3"
    );
}

/// Fetch every pinned jar and verify it, or `None` if there is no network.
///
/// **A mismatch is a failure, not a skip.** Being unable to reach Maven Central
/// is a fact about this machine; getting different bytes from it is a fact
/// about the supply chain, and the two must not look alike.
fn dependencies() -> Option<Vec<PathBuf>> {
    fetch(&["runtime"])
}

fn fetch(scopes: &[&str]) -> Option<Vec<PathBuf>> {
    let curl = tool("curl")?;
    let cache = std::env::temp_dir().join("nts-okhttp-deps");
    std::fs::create_dir_all(&cache).ok()?;
    let mut jars = Vec::new();
    for pin in pinned().into_iter().filter(|pin| scopes.contains(&pin.scope.as_str())) {
        let name = format!("{}-{}.jar", pin.artifact, pin.version);
        let path = cache.join(&name);
        if !path.exists() {
            let url = format!(
                "{}/{}/{}/{}/{name}",
                pin.repository,
                pin.group.replace('.', "/"),
                pin.artifact,
                pin.version
            );
            let fetched = Command::new(&curl)
                .args(["-sSfL", "--max-time", "120", "-o"])
                .arg(&path)
                .arg(&url)
                .output()
                .ok()?;
            if !fetched.status.success() {
                let _ = std::fs::remove_file(&path);
                return None;
            }
        }
        let bytes = std::fs::read(&path).ok()?;
        let found = digest(&bytes);
        assert_eq!(
            found, pin.sha256,
            "{name} does not hash to the digest `dependencies.tsv` pins it to. This is not a \
             network problem -- the bytes arrived and they are the wrong bytes. Do not update \
             the pin to match; find out why it changed."
        );
        jars.push(path);
    }
    Some(jars)
}

/// The production provider must not rewrite the response.
///
/// Four `OkHttp` defaults change *what happens* -- redirects, cookies, caching,
/// retries -- and each is a piece of observable `Fetch` behaviour the shared
/// TypeScript already owns. Transparent decompression is the one that changes
/// what the response **says**: `OkHttp` adds `Accept-Encoding: gzip` when the
/// caller has not, decompresses what it gets, and strips `Content-Encoding` and
/// `Content-Length` because they would describe bytes it has replaced.
///
/// Correct of `OkHttp`, wrong here. With the header left to it, the sabotage
/// reports exactly that:
///
///     Content-Encoding came back as null
///     Content-Length came back as null rather than the 156 bytes the server sent
///     the body was 40000 bytes rather than the 156 the server sent
///
/// Skips when the dependencies cannot be fetched. Fails, loudly, when they can
/// be fetched and are not the pinned bytes.
#[test]
fn okhttp_does_not_rewrite_what_the_server_sent() {
    let (Some(javac), Some(java), Some(jars)) = (tool("javac"), tool("java"), dependencies())
    else {
        return;
    };
    let root = repository();
    let dir = std::env::temp_dir().join(format!("nts-okhttp-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let classpath = jars
        .iter()
        .map(|jar| jar.display().to_string())
        .chain(std::iter::once(dir.display().to_string()))
        .collect::<Vec<_>>()
        .join(":");

    for source in [
        android().join("src/okhttp/java/org/nts/web/OkHttpNetworking.java"),
        root.join("compiler/codegen/jvm/tests/android/OkHttpHeadersTest.java"),
    ] {
        let compiled = Command::new(&javac)
            .args(["--release", "8", "-Xlint:-options", "-cp"])
            .arg(&classpath)
            .arg("-d")
            .arg(&dir)
            .arg(&source)
            .output()
            .unwrap();
        assert!(
            compiled.status.success(),
            "{} did not compile:\n{}",
            source.display(),
            String::from_utf8_lossy(&compiled.stderr)
        );
    }

    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(&classpath)
        .arg("OkHttpHeadersTest")
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).trim().to_owned();
    assert!(ran.status.success(), "{said}\n{}", String::from_utf8_lossy(&ran.stderr));
    // The **count**, not only the zero: a suite that stopped running half its
    // cases reports no failures perfectly well. Same assertion as `PASS: 11`
    // above, which is where the idea came from and where it stopped.
    assert!(said.ends_with("19 checks, 0 failures"), "{said}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// The two adapters, over one server, answering the same.
///
/// The plan's central two-adapter requirement, and the one thing the suites
/// around it could not check. `OkHttpHeadersTest` drives `OkHttp` alone and
/// asserts what it does; `HttpGzipTest` drives the reference alone and asserts
/// what it does, closing with "this is the observable the production adapter has
/// to match". Nothing checked that it matched. Two suites agreeing with their
/// own expectations is not two adapters agreeing with each other.
///
/// The count is the ratchet the plan asks for -- "capture the applicable-case
/// count when the corpus lands, and it may only rise". Pinned exactly rather
/// than as a lower bound, so adding a case is a deliberate edit here and
/// removing one cannot pass quietly.
#[test]
fn both_adapters_answer_the_same_over_one_server() {
    let (Some(javac), Some(java), Some(jars)) = (tool("javac"), tool("java"), dependencies())
    else {
        return;
    };
    let root = repository();
    let dir = std::env::temp_dir().join(format!("nts-both-http-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();

    // The runtime jar as well as the pinned dependencies: this corpus drives
    // `nts.rt.NtsSocket` on one side and OkHttp on the other, which is the
    // whole point of it.
    let runtime = std::env::var_os("NTS_JVM_RUNTIME_JAR")
        .map_or_else(|| root.join("runtime/jvm/nts-runtime.jar"), PathBuf::from);
    let mine = dir.join("nts-runtime.jar");
    std::fs::copy(&runtime, &mine).unwrap();

    let classpath = jars
        .iter()
        .map(|jar| jar.display().to_string())
        .chain(std::iter::once(mine.display().to_string()))
        .chain(std::iter::once(dir.display().to_string()))
        .collect::<Vec<_>>()
        .join(":");

    for source in [
        android().join("src/okhttp/java/org/nts/web/OkHttpNetworking.java"),
        root.join("compiler/codegen/jvm/tests/android/BothHttp.java"),
    ] {
        let compiled = Command::new(&javac)
            .args(["--release", "8", "-Xlint:-options", "-cp"])
            .arg(&classpath)
            .arg("-d")
            .arg(&dir)
            .arg(&source)
            .output()
            .unwrap();
        assert!(
            compiled.status.success(),
            "{} did not compile:\n{}",
            source.display(),
            String::from_utf8_lossy(&compiled.stderr)
        );
    }

    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(&classpath)
        .arg("BothHttp")
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).trim().to_owned();
    assert!(ran.status.success(), "{said}\n{}", String::from_utf8_lossy(&ran.stderr));
    assert!(said.ends_with("78 checks, 0 failures"), "{said}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// The third-party jars dex at the same API floor, and are **not** held to the
/// NTS-only rule.
///
/// The plan is explicit that the zero-invokedynamic rule must not be applied to
/// third-party jars, and it is worth being precise about why rather than just
/// obeying it. That rule exists so NTS-authored Java desugars predictably and
/// stays legible as bytes; `OkHttp` is Kotlin, ships whatever its own toolchain
/// produced, and is reviewed as a dependency -- on its version, its hash, its
/// license and its behaviour. Counting its `invoke-custom` instructions would
/// be measuring someone else's compiler against our house style.
///
/// What *is* our problem is whether it reaches a device at all, so it is dexed
/// at the same `--min-api 26` and required to succeed. That is the question a
/// pinned dependency can actually fail.
#[test]
fn the_pinned_dependencies_dex_at_the_same_api_floor() {
    let (Some((tools, platform)), Some(jars)) = (sdk(), dependencies()) else { return };
    let dir = std::env::temp_dir().join(format!("nts-deps-dex-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut dex = Command::new(tools.join("d8"));
    dex.args(["--min-api", "26", "--lib"]).arg(&platform).arg("--output").arg(&dir);
    for jar in &jars {
        dex.arg(jar);
    }
    let ran = dex.output().unwrap();
    assert!(
        ran.status.success(),
        "d8 refused the pinned dependencies at API 26:\n{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    let produced = dir.join("classes.dex");
    assert!(produced.exists(), "d8 produced no dex for the pinned dependencies");
    let dumped = Command::new(tools.join("dexdump")).arg("-d").arg(&produced).output().unwrap();
    let listing = String::from_utf8_lossy(&dumped.stdout);
    assert!(
        listing.contains("Lokhttp3/OkHttpClient;"),
        "the dependency dex does not mention OkHttp's own client class, so whatever it \
         contains is not what was pinned"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// R8 shrinks the library and the keep rules are what stops it shrinking the
/// part an FFI reaches.
///
/// D8 only translates; R8 also *removes*, and what it removes is whatever it
/// cannot see a path to. Every entry point of this library is called from
/// outside Java, so R8 sees a path to none of them -- `consumer-rules.pro` is
/// the whole reason the artifact still has a surface after shrinking, and a
/// rule that stops matching is silent until something calls the method that is
/// no longer there.
///
/// So the assertion is that the kept classes survive **and** that the internals
/// do not: `NetworkPrimitives$Connection` and `$TimerEntry` are private and
/// must be gone, because a run where R8 removed nothing at all would satisfy
/// "the kept classes are still here" without shrinking anything.
#[test]
fn r8_keeps_the_ffi_surface_and_removes_the_rest() {
    let (Some(javac), Some(java), Some((tools, platform))) = (tool("javac"), tool("java"), sdk())
    else {
        return;
    };
    let Some(r8) = fetch(&["tool"]).and_then(|jars| jars.into_iter().next()) else { return };
    // The production adapter is compiled and shrunk here too. It was not, and
    // it has no caller in Java either -- so every method on it was one R8 run
    // away from being removed from a release build, exactly the way
    // `AndroidNetworking`'s keep rule once matched nothing because this test
    // never compiled `src/android`.
    let Some(jars) = dependencies() else { return };
    let dir = std::env::temp_dir().join(format!("nts-r8-{}", std::process::id()));
    let classes = dir.join("classes");
    let out = dir.join("out");
    std::fs::create_dir_all(&classes).unwrap();
    std::fs::create_dir_all(&out).unwrap();

    let compile_path = std::iter::once(platform.display().to_string())
        .chain(jars.iter().map(|jar| jar.display().to_string()))
        .collect::<Vec<_>>()
        .join(":");
    let mut compile = Command::new(&javac);
    compile.args(["--release", "8", "-Xlint:-options", "-cp"]).arg(&compile_path).arg("-d").arg(&classes);
    for path in sources(&android().join("src/main"))
        .into_iter()
        .chain(sources(&android().join("src/android")))
        .chain(sources(&android().join("src/okhttp")))
    {
        compile.arg(path);
    }
    let built = compile.output().unwrap();
    assert!(built.status.success(), "javac: {}", String::from_utf8_lossy(&built.stderr));

    let mut shrink = Command::new(&java);
    shrink
        .arg("-cp")
        .arg(&r8)
        .args(["com.android.tools.r8.R8", "--release", "--min-api", "26", "--lib"])
        .arg(&platform);
    // The third-party jars as libraries rather than inputs: what is being
    // shrunk is NTS-owned Java, and dexing OkHttp here would be measuring
    // someone else's artifact -- which `the_pinned_dependencies_dex_at_the_same_api_floor`
    // already does, on its own terms.
    for jar in &jars {
        shrink.arg("--lib").arg(jar);
    }
    shrink
        .arg("--pg-conf")
        .arg(android().join("consumer-rules.pro"))
        .arg("--output")
        .arg(&out);
    for path in sources_of(&classes) {
        shrink.arg(path);
    }
    let ran = shrink.output().unwrap();
    assert!(
        ran.status.success(),
        "R8 refused the library:\n{}",
        String::from_utf8_lossy(&ran.stderr)
    );

    let dumped = Command::new(tools.join("dexdump"))
        .arg("-d")
        .arg(out.join("classes.dex"))
        .output()
        .unwrap();
    let listing = String::from_utf8_lossy(&dumped.stdout);
    for kept in [
        "Lorg/nts/web/NetworkPrimitives;",
        "Lorg/nts/web/AndroidNetworking;",
        "Lorg/nts/web/NetworkPrimitives$ConnectCallback;",
        "Lorg/nts/web/NetworkPrimitives$ReadCallback;",
        "Lorg/nts/web/NetworkPrimitives$WriteCallback;",
        "Lorg/nts/web/NetworkPrimitives$CleartextPolicy;",
        "Lorg/nts/web/OkHttpNetworking;",
        "Lorg/nts/web/OkHttpNetworking$ResponseCallback;",
    ] {
        assert!(
            listing.contains(kept),
            "R8 removed {kept}, which `consumer-rules.pro` keeps. Nothing in Java calls it -- \
             the callers are on the other side of an FFI -- so a keep rule that stops matching \
             is silent until something calls a method that is no longer there"
        );
    }
    for gone in ["Lorg/nts/web/NetworkPrimitives$Connection;", "Lorg/nts/web/NetworkPrimitives$TimerEntry;"] {
        assert!(
            !listing.contains(gone),
            "R8 kept {gone}, which is private and reached only from inside. A run that removed \
             nothing would pass every assertion above without shrinking anything"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

/// Every `.class` under a directory, for handing to `d8`.
fn sources_of(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(at) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&at) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|it| it == "class") {
                found.push(path);
            }
        }
    }
    found.sort();
    found
}

/// The two `CONNECT` tunnels, against one proxy, required to answer the same.
///
/// `nts.rt.NtsSocket` and `org.nts.web.NetworkPrimitives` each speak it and
/// neither can call the other -- this library depends on no NTS runtime, which
/// is what lets it be built into an Android library on its own. So there are
/// two implementations of something subtle, and the rule this repository keeps
/// is that where two things must agree and only one can be deleted, the second
/// one asserts rather than computes.
///
/// The certificate names `localhost` and the proxy is on `127.0.0.1`, so a
/// tunnel to `localhost` must succeed on both and one to `127.0.0.1` must fail
/// on both.
#[test]
fn the_two_tunnels_answer_the_same_through_one_proxy() {
    let (Some(javac), Some(java), Some(keytool)) = (tool("javac"), tool("java"), tool("keytool"))
    else {
        return;
    };
    let root = repository();
    let dir = std::env::temp_dir().join(format!("nts-both-tunnels-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    build(&javac, &dir).unwrap_or_else(|error| panic!("the Android primitives did not compile:\n{error}"));

    let jar = std::env::var_os("NTS_JVM_RUNTIME_JAR")
        .map_or_else(|| root.join("runtime/jvm/nts-runtime.jar"), PathBuf::from);
    let mine = dir.join("nts-runtime.jar");
    std::fs::copy(&jar, &mine).unwrap();

    let server = dir.join("server.p12");
    let cert = dir.join("nts.cer");
    let trust = dir.join("trust.p12");
    for args in [
        vec!["-genkeypair", "-alias", "nts", "-keyalg", "RSA", "-keysize", "2048",
             "-validity", "1", "-dname", "CN=nts-test", "-ext", "SAN=dns:localhost",
             "-keystore", server.to_str().unwrap(), "-storetype", "PKCS12",
             "-storepass", "changeit", "-keypass", "changeit"],
        vec!["-exportcert", "-alias", "nts", "-storetype", "PKCS12", "-storepass", "changeit",
             "-keystore", server.to_str().unwrap(), "-file", cert.to_str().unwrap()],
        vec!["-importcert", "-noprompt", "-alias", "nts", "-storetype", "PKCS12",
             "-storepass", "changeit", "-file", cert.to_str().unwrap(),
             "-keystore", trust.to_str().unwrap()],
    ] {
        let ran = Command::new(&keytool).args(&args).output().unwrap();
        assert!(ran.status.success(), "keytool: {}", String::from_utf8_lossy(&ran.stderr));
    }

    let classpath = format!("{}:{}", mine.display(), dir.display());
    let compiled = Command::new(&javac)
        .args(["--release", "8", "-Xlint:-options", "-cp"])
        .arg(&classpath)
        .arg("-d")
        .arg(&dir)
        .arg(root.join("compiler/codegen/jvm/tests/android/BothTunnels.java"))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "BothTunnels did not compile:\n{}",
        String::from_utf8_lossy(&compiled.stderr)
    );

    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg(format!("-Djavax.net.ssl.keyStore={}", server.display()))
        .arg("-Djavax.net.ssl.keyStorePassword=changeit")
        .arg("-Djavax.net.ssl.keyStoreType=PKCS12")
        .arg(format!("-Djavax.net.ssl.trustStore={}", trust.display()))
        .arg("-Djavax.net.ssl.trustStorePassword=changeit")
        .arg("-Djavax.net.ssl.trustStoreType=PKCS12")
        .arg("-cp")
        .arg(&classpath)
        .arg("BothTunnels")
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).trim().to_owned();
    assert!(ran.status.success(), "{said}\n{}", String::from_utf8_lossy(&ran.stderr));
    // The **count**, not only the zero: a suite that stopped running half its
    // cases reports no failures perfectly well. Same assertion as `PASS: 11`
    // above, which is where the idea came from and where it stopped.
    assert!(said.ends_with("37 checks, 0 failures"), "{said}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// The artifact rules, checked against the bytes rather than the build file.
///
/// `build.gradle.kts` says `VERSION_1_8` and `minSdk = 26`, and a build file is
/// a statement of intent that nothing verifies. These read the class files.
#[test]
fn the_library_is_java_eight_and_names_no_sdk_outside_its_one_sdk_file() {
    let Some(javac) = tool("javac") else { return };
    let dir = std::env::temp_dir().join(format!("nts-android-bytes-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    build(&javac, &dir).unwrap_or_else(|error| panic!("the Android primitives did not compile:\n{error}"));

    let mut checked = 0;
    let mut stack = vec![dir.clone()];
    while let Some(at) = stack.pop() {
        for entry in std::fs::read_dir(&at).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if path.extension().is_none_or(|it| it != "class") {
                continue;
            }
            let bytes = std::fs::read(&path).unwrap();
            let major = u16::from_be_bytes([bytes[6], bytes[7]]);
            assert_eq!(
                major,
                52,
                "{} is class file version {major}; the library declares Java 8 and D8 is \
                 entitled to refuse anything newer",
                path.display()
            );
            checked += 1;
        }
    }
    assert!(checked >= 8, "only {checked} classes were checked, which is fewer than this \
        library has -- the build produced less than it should have");

    // The SDK dependency is one file, and that is what makes the rest of it
    // testable here. A second `android.*` import anywhere in `src/main` would
    // take the whole suite off this machine and onto a device, silently: the
    // Gradle build would still pass, because Gradle has the SDK.
    for path in sources(&android().join("src/main")) {
        let source = std::fs::read_to_string(&path).unwrap();
        for line in source.lines() {
            assert!(
                !line.trim_start().starts_with("import android."),
                "{} imports the Android SDK. `src/main` is deliberately free of it -- the \
                 whole dependency is `AndroidNetworking` in `src/android`, which is what lets \
                 every other line of this library be tested against real sockets on a machine \
                 with no Android on it",
                path.display()
            );
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}
