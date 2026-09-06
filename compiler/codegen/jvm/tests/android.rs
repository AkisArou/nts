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
    assert!(said.ends_with("0 failures"), "{said}");
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
