// The peak-RSS row of clbg-fasta at work(8192): the whole program,
// derived from launch.json by tooling/bench/launch-marker.ts, which refuses
// any other text. tooling/bench/README.md, "Peak-RSS rows", says how it is measured.
import { work } from "../clbg-fasta/case.ts";
console.log(work(8192));
