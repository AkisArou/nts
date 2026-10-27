// Cross integer representation boundaries in seven iterations. The visit
// limit also makes an incorrectly wrapping counter finish and disagree,
// instead of hanging the differential. smallControl has the same loop body.

export function crossInt32Max(): number {
  let visits = 0;
  let sum = 0;
  for (let counter = 2147483644; counter < 2147483651 && visits < 10; counter = counter + 1) {
    sum = sum + (counter - 2147483644);
    visits = visits + 1;
  }
  return sum * 100 + visits;
}

export function crossSignBit(): number {
  let visits = 0;
  let sum = 0;
  for (let counter = 2147483645; counter < 2147483652 && visits < 10; counter = counter + 1) {
    sum = sum + (counter - 2147483645);
    visits = visits + 1;
  }
  return sum * 100 + visits;
}

export function crossUint32Max(): number {
  let visits = 0;
  let sum = 0;
  for (let counter = 4294967292; counter < 4294967299 && visits < 10; counter = counter + 1) {
    sum = sum + (counter - 4294967292);
    visits = visits + 1;
  }
  return sum * 100 + visits;
}

export function smallControl(): number {
  let visits = 0;
  let sum = 0;
  for (let counter = 0; counter < 7 && visits < 10; counter = counter + 1) {
    sum = sum + (counter - 0);
    visits = visits + 1;
  }
  return sum * 100 + visits;
}
