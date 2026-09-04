//! `String(x)` for a hundred thousand doubles, against node.
//!
//! # Why a random sweep rather than a table of cases
//!
//! This function has one job -- produce the characters the language says --
//! and its failures are *sparse*. The first version of it used `HALF_UP` to
//! break a tie between two equally short representations, because the
//! specification was recalled rather than read; it says **even**. That
//! disagreed with node on 27 of 99,957 random doubles, all of them a last digit
//! 3 where node says 2.
//!
//! 0.027% is the shape that survives a test suite. Every hand-written case
//! passed. Every example passed. It is too rare for a fixture to hit by
//! accident and too common to leave in a compiler, and the only instrument that
//! finds it is volume against the oracle.
//!
//! # Why it is standing rather than a run somebody did once
//!
//! It passed on the day it was written, by someone who had just been wrong
//! about the rule. That is a fact about that day. A test that runs is the only
//! thing that says the tie-break still holds *now* -- which is the whole
//! argument for a sabotage test, one level down: what a check buys is a
//! timestamp, not a proof.
//!
//! Skips without a JDK or without node, and the gate step that runs it needs
//! both.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::process::Command;

/// How many doubles. Large enough that a one-in-ten-thousand rule error shows,
/// small enough that the whole test is a few seconds.
const HOW_MANY: usize = 100_000;

/// Fixed, so a failure is reproducible by anyone who runs this rather than by
/// whoever happened to see it.
const SEED: u64 = 20_260_904;

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

#[test]
fn every_double_prints_the_characters_node_prints() {
    let (Some(javac), Some(java), Some(node)) = (tool("javac"), tool("java"), tool("node")) else {
        return;
    };
    let root = repository();
    let dir = std::env::temp_dir().join(format!("nts-n2s-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();

    // `NTS_JVM_RUNTIME_JAR` for the same reason the sabotage test uses it: to
    // break this check on purpose without editing the checked-in artifact,
    // which another session may be building against at the same moment.
    let jar = std::env::var_os("NTS_JVM_RUNTIME_JAR")
        .map_or_else(|| root.join("runtime/jvm/nts-runtime.jar"), PathBuf::from);
    let driver = dir.join("Sweep.java");
    std::fs::write(
        &driver,
        format!(
            r"public class Sweep {{
  public static void main(String[] a) {{
    java.util.Random rng = new java.util.Random({SEED}L);
    StringBuilder out = new StringBuilder();
    // Every power of two first, and the reason is worth the four lines.
    //
    // A random bit pattern is a hostile double and it found the last-digit bug
    // this file was written for. It is *blind* to a value with a short binary
    // representation: 46 of 2,098 powers of two printed with one digit too many
    // -- `2^-24` as `5.9604644775390625e-8` where node prints
    // `5.960464477539063e-8` -- and the same build got 0 wrong in 299,827
    // random patterns. Random sampling cannot reach them, and a program
    // produces them constantly.
    for (int e = -1074; e <= 1023; e++) {{
      double p = Math.scalb(1.0, e);
      if (p == 0 || Double.isInfinite(p)) continue;
      out.append(Long.toHexString(Double.doubleToRawLongBits(p))).append(' ')
         .append(nts.rt.NtsRuntime.numberToString(p)).append('\n');
      double h = p * 3;
      if (!Double.isInfinite(h) && h != 0) {{
        out.append(Long.toHexString(Double.doubleToRawLongBits(h))).append(' ')
           .append(nts.rt.NtsRuntime.numberToString(h)).append('\n');
      }}
    }}
    for (int i = 0; i < {HOW_MANY}; i++) {{
      long bits = rng.nextLong();
      double d = Double.longBitsToDouble(bits);
      if (Double.isNaN(d) || Double.isInfinite(d)) continue;
      out.append(Long.toHexString(bits)).append(' ')
         .append(nts.rt.NtsRuntime.numberToString(d)).append('\n');
    }}
    System.out.print(out);
  }}
}}"
        ),
    )
    .unwrap();

    let built = Command::new(&javac)
        .arg("-cp")
        .arg(&jar)
        .arg("-d")
        .arg(&dir)
        .arg(&driver)
        .output()
        .unwrap();
    assert!(built.status.success(), "javac: {}", String::from_utf8_lossy(&built.stderr));

    let swept = Command::new(&java)
        .arg("-cp")
        .arg(format!("{}:{}", dir.display(), jar.display()))
        .arg("Sweep")
        .output()
        .unwrap();
    assert!(swept.status.success(), "java: {}", String::from_utf8_lossy(&swept.stderr));
    let ours = dir.join("ours.txt");
    std::fs::write(&ours, &swept.stdout).unwrap();

    // node reads the *bit patterns*, not the decimal text, so the two sides
    // cannot agree by having parsed the same spelling of a number.
    let checker = dir.join("check.mjs");
    std::fs::write(
        &checker,
        r#"import { readFileSync } from "node:fs";
const dv = new DataView(new ArrayBuffer(8));
let bad = [], n = 0;
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  if (!line) continue;
  const [hex, theirs] = line.split(" ");
  dv.setBigUint64(0, BigInt("0x" + hex));
  const mine = String(dv.getFloat64(0));
  n++;
  if (mine !== theirs) bad.push(`${hex}: jvm=${theirs} node=${mine}`);
}
console.log(`${n} ${bad.length}`);
for (const b of bad.slice(0, 10)) console.log(b);
"#,
    )
    .unwrap();

    let compared = Command::new(&node).arg(&checker).arg(&ours).output().unwrap();
    assert!(compared.status.success(), "node: {}", String::from_utf8_lossy(&compared.stderr));
    let report = String::from_utf8_lossy(&compared.stdout);
    let mut lines = report.lines();
    let counts = lines.next().unwrap_or("0 0");
    let (compared_count, disagreed) = counts.split_once(' ').unwrap_or(("0", "0"));
    let compared_count: usize = compared_count.parse().unwrap_or(0);
    let disagreed: usize = disagreed.parse().unwrap_or(usize::MAX);

    // A sweep that compared nothing is not a sweep that agreed, which is the
    // same distinction the gate draws with `5 compared nothing`.
    assert!(
        compared_count > HOW_MANY / 2,
        "only {compared_count} of {HOW_MANY} doubles were compared, so this proves nothing"
    );
    assert_eq!(
        disagreed,
        0,
        "{disagreed} of {compared_count} doubles print differently from node:\n{}",
        lines.collect::<Vec<_>>().join("\n")
    );
    let _ = std::fs::remove_dir_all(&dir);
}
