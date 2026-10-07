// The one program the test embedder links (embedder/probe.c calls these):
// the boundary and DOM witnesses, and the benchmark workloads.
export {
  ntsChromiumProbe, ntsChromiumText, ntsChromiumCreateCounter, ntsChromiumIncrementCounter, ntsChromiumCounterValue,
  ntsChromiumAwaitCounter,
} from "../../tests/boundary.ts";
export { ntsChromiumDomProgram, ntsChromiumDomCounter } from "../../tests/dom-witness.ts";
export { ntsChromiumPrepareBenchmark, ntsChromiumBenchmarkLoop } from "../../benchmarks/workloads/binding.ts";
export { ntsRowsCreate, ntsRowsOperate, ntsRowsDestroy } from "../../benchmarks/workloads/rows.ts";
export { ntsKernelCanvasRects, ntsKernelCreateElements, ntsKernelCounterTrees, ntsKernelEventRoundTrips } from "../../benchmarks/workloads/kernels.ts";
export { ntsTodoCreate, ntsTodoDestroy } from "../../benchmarks/workloads/todo.ts";
// The same TodoMVC typed by the stock lib.dom.d.ts, bound by delegation
// (benchmark.ts --todo-source lib-dom).
export { ntsTodoDomCreate } from "../../benchmarks/workloads/todo-lib-dom.ts";
