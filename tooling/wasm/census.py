"""Emit every discovered example and account for bounded scalar/string comparisons.

One frontend at a time. Partial results and compiler/Node logs survive failures.
Primitive thrown values are compared too. This remains a bounded bring-up
census, not the full hostile-pool M1 differential lane.
"""

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess


def run(args, cwd, timeout):
    try:
        result = subprocess.run(args, cwd=cwd, capture_output=True, timeout=timeout)
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired as error:
        return None, error.stdout or b"", error.stderr or b""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nts", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--only", help="comma-separated project names for an explicit follow-up")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    binary = args.nts.resolve()
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=True)
    projects = sorted((root / "examples").glob("*/tsconfig.json"))
    if args.only:
        selected = set(args.only.split(","))
        projects = [p for p in projects if p.parent.name in selected]
        if {p.parent.name for p in projects} != selected:
            raise SystemExit("unknown project in --only")
    report = {
        "created_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
        "binary": str(binary), "binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
        "root": str(root), "discovered": len(projects), "complete": False,
        "population": "bounded numeric/bool/string sweep; returns, primitive throws and live globals; not full M1 agree",
        "frontend_jobs": 1, "rows": [],
    }

    def save():
        totals = dict.fromkeys(["emitted", "agree", "declined", "invalid", "wrong", "unmeasured", "timed_out", "cases", "thrown_cases", "input_declines"], 0)
        for row in report["rows"]:
            totals[row["outcome"]] += 1
            totals["emitted"] += int(row.get("emitted", False))
            totals["cases"] += row.get("execution", {}).get("cases", 0)
            totals["thrown_cases"] += row.get("execution", {}).get("thrownCases", 0)
            totals["input_declines"] += row.get("execution", {}).get("inputDeclines", 0)
        report["totals"] = totals
        temporary = output / "report.json.tmp"
        temporary.write_text(json.dumps(report, indent=2) + "\n")
        temporary.replace(output / "report.json")

    save()
    marker = Path(os.environ.get("NTS_GATE_MARKER", root.parent / "GATE-RUNNING"))
    for index, config in enumerate(projects):
        if marker.exists():
            raise SystemExit("gate active: retained partial report; resume after coordination")
        name = config.parent.name
        case_dir = output / name
        case_dir.mkdir(exist_ok=True)
        artifact = case_dir / "artifact"
        row = {"name": name, "config": str(config.relative_to(root))}
        code, stdout, stderr = run([str(binary), "emit-wasm", str(config), "--out", str(artifact)], root, 180)
        (case_dir / "compiler.stdout").write_bytes(stdout)
        (case_dir / "compiler.stderr").write_bytes(stderr)
        text = (stdout + stderr).decode(errors="replace")
        row["compiler_status"] = code
        if code is None:
            row["outcome"] = "timed_out"
        elif code:
            if ("invalid HIR" in text or "invalid prepared HIR" in text
                    or "invalid generated wasm" in text or "internal wasm" in text
                    or "panicked" in text):
                row["outcome"] = "invalid"
            elif "the program does not typecheck" in text and "TS" in text:
                row["outcome"] = "declined"
                row["decline_stage"] = "frontend"
            elif "NTS5001" in text or "NTS2001" in text or "preparation declined" in text:
                row["outcome"] = "declined"
            else:
                row["outcome"] = "unmeasured"
            row["reason"] = text[-4000:]
        else:
            row["emitted"] = True
            entries = [config.parent / f"src/main.{suffix}" for suffix in ["ts", "tsx", "js", "mjs"]]
            source = next((p for p in entries if p.is_file()), entries[0])
            if not source.is_file():
                row["outcome"] = "unmeasured"
                row["reason"] = "no conventional src/main.ts oracle entry"
            else:
                result_file = case_dir / "execution.json"
                status, stdout, stderr = run([
                    "node", "--experimental-transform-types", str(root / "tooling/wasm/check-corpus-example.mjs"),
                    str(artifact), str(source), str(result_file),
                ], root, 30)
                (case_dir / "node.stdout").write_bytes(stdout)
                (case_dir / "node.stderr").write_bytes(stderr)
                row["node_status"] = status
                if result_file.is_file():
                    row["execution"] = json.loads(result_file.read_text())
                execution = row.get("execution", {})
                if execution.get("moduleInitDecline"):
                    row["outcome"] = "declined"
                    row["decline_stage"] = "module-initialization"
                    row["reason"] = execution["moduleInitDecline"]
                elif execution.get("failure") and execution.get("phase") == "wasm-load":
                    row["outcome"] = "invalid"
                elif execution.get("wrong"):
                    row["outcome"] = "wrong"
                elif status is None or execution.get("timeouts"):
                    row["outcome"] = "timed_out"
                elif status != 0 or execution.get("missing"):
                    row["outcome"] = "unmeasured"
                elif execution.get("cases", 0) or execution.get("globals", 0):
                    row["outcome"] = "agree"
                else:
                    row["outcome"] = "unmeasured"
                    row["reason"] = "artifact emitted but no supported case/global compared"
        report["rows"].append(row)
        save()
        print(f"{index + 1}/{len(projects)} {name}: {row['outcome']}", flush=True)
        # A gate has exclusive resource use; retain progress and yield it.
        if marker.exists():
            raise SystemExit("gate started: retained partial report; resume after coordination")
    report["complete"] = True
    save()
    print(json.dumps(report["totals"], sort_keys=True))


if __name__ == "__main__":
    main()
