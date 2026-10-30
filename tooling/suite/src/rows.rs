//! Optional source-ordered evidence for comparing corpus revisions. Recording
//! observes the existing result; it never changes a compiler question or verdict.

use std::fs::File;
use std::io::{BufWriter, Write};

use anyhow::{Context, Result};
use camino::Utf8Path;
use serde::Serialize;

use super::Examined;

pub(super) struct Writer(Option<BufWriter<File>>);

#[derive(Serialize)]
struct Row<'a> {
    path: &'a str,
    source_hash: Option<String>,
    examined: &'a Examined,
}

impl Writer {
    pub(super) fn from_args() -> Result<Self> {
        let mut args = std::env::args();
        while let Some(arg) = args.next() {
            if arg == "--rows" {
                let path = args.next().context("`--rows` needs a JSONL path")?;
                return Self::open(Utf8Path::new(&path));
            }
        }
        Ok(Self(None))
    }

    fn open(path: &Utf8Path) -> Result<Self> {
        Ok(Self(Some(BufWriter::new(
            File::create(path).with_context(|| format!("creating corpus rows at {path}"))?,
        ))))
    }

    pub(super) fn record(&mut self, file: &Utf8Path, examined: &Examined) -> Result<()> {
        let Some(output) = self.0.as_mut() else {
            return Ok(());
        };
        // Both upstream layouts end in this path. Keep the case identity the
        // same across pins; the hash distinguishes changed source contents.
        let path = file
            .as_str()
            .split_once("/testdata/tests/cases/")
            .map_or(file.as_str(), |(_, relative)| relative);
        let source_hash = std::fs::read(file)
            .ok()
            .map(|bytes| format!("{:032x}", xxhash_rust::xxh3::xxh3_128(&bytes)));
        serde_json::to_writer(
            &mut *output,
            &Row {
                path,
                source_hash,
                examined,
            },
        )?;
        output.write_all(b"\n")?;
        Ok(())
    }

    pub(super) fn finish(&mut self) -> Result<()> {
        if let Some(output) = self.0.as_mut() {
            output.flush().context("flushing corpus rows")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Outcome;

    #[test]
    fn rows_preserve_case_identity_failure_detail_and_verification() {
        let scratch = crate::corpus_input_tests::Scratch::open();
        let case = scratch.0.join("testdata/tests/cases/compiler/a.ts");
        std::fs::create_dir_all(case.parent().expect("case directory")).expect("directories");
        std::fs::write(&case, b"export const x = 1;").expect("source");
        let path = scratch.0.join("rows.jsonl");
        let mut output = Writer::open(&path).expect("rows");
        output
            .record(
                &case,
                &Examined {
                    outcome: Outcome::Refused(vec!["a specific refusal".to_owned()]),
                    notes: vec!["C syntax error".to_owned()],
                    uncompilable: true,
                    unverifiable: false,
                    incomplete: Vec::new(),
                },
            )
            .expect("record");
        output.finish().expect("flush");
        let text = std::fs::read_to_string(&path).expect("rows text");
        let row: serde_json::Value = serde_json::from_str(&text).expect("one row");
        assert_eq!(row["path"], "compiler/a.ts");
        assert_eq!(row["source_hash"].as_str().expect("hash").len(), 32);
        assert_eq!(
            row["examined"]["outcome"]["Refused"][0],
            "a specific refusal"
        );
        assert_eq!(row["examined"]["notes"][0], "C syntax error");
        assert_eq!(row["examined"]["uncompilable"], true);
        assert_eq!(row["examined"]["unverifiable"], false);
    }
}
