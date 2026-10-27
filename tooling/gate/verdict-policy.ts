// Standing verdict policy shared by ordinary landings and full runs. A skip
// stays a named SKIPPED result; acceptance never turns it into a PASS.
export const STANDING_GATE_POLICY = Object.freeze({
  NTS_GATE_ACCEPT_SKIP: "on-device",
});
