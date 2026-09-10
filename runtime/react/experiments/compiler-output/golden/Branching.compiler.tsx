import { c as _c } from "react/compiler-runtime";
type Props = {
  enabled: boolean;
  primary: string;
  secondary: string;
};
export function Branching(t0) {
  const $ = _c(4);
  const {
    enabled,
    primary,
    secondary
  } = t0;
  const label = enabled ? primary : secondary;
  let t1;
  if ($[0] !== label) {
    t1 = label.toUpperCase();
    $[0] = label;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== t1) {
    t2 = <label>{t1}</label>;
    $[2] = t1;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  return t2;
}
