const reads = function Named() {
  return typeof Named;
};
const assigns = function Named() {
  Named = 1;
  return typeof Named;
};
export function run() {
  const rows = [["read control", reads()]];
  let threw = "nothing";
  try {
    rows.push(["assign arm", assigns()]);
  } catch (error) {
    threw = error instanceof TypeError ? "TypeError" : "another error";
  }
  rows.push(["threw", threw]);
  return rows;
}
