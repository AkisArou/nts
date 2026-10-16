// On main 585d41ee3 the original four arms compare 116 calls with 58 wrong
// writes; var controls agree. The added head read was a named NTS1001 refusal.
// Each head read/write control changes only let to var. Pattern defaults must
// keep their per-binding order: x is ready by the time y=x runs.
// expect-ir: all: no field.get in forOfHeadControl
// expect-ir: all: no field.get in forInHeadControl
// expect-ir: all: no field.get in headDefaultReady
// expect-ir: all: no field.get in headDefaultControl
export { forOfHead, forOfHeadControl, forInHead, forInHeadControl, forOfHeadRead, forOfHeadReadControl, headDefaultReady, headDefaultControl } from "./case.js";
