// Children: whitespace-only text on one line is kept, across lines it is
// dropped; multi-line text joins its lines with one space; a spread child
// makes the children static.
export function Children({ xs, n }: { xs: string[]; n: number }) {
  return (
    <div>
      <b> </b>
      <i>{...xs}</i>
      <span>only</span>
      <span>
        one
        two
      </span>
      <em>{n} items</em>
      <u>
      </u>
      <s>  lead and trail  </s>
    </div>
  );
}
