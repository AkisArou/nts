import { c as _c } from "react/compiler-runtime";
import { useEffect } from 'react';
type Props = {
  value: number;
  onChange: (value: number) => void;
};
export function Effect(t0) {
  const $ = _c(6);
  const {
    value,
    onChange
  } = t0;
  let t1;
  let t2;
  if ($[0] !== onChange || $[1] !== value) {
    t1 = () => {
      onChange(value);
    };
    t2 = [onChange, value];
    $[0] = onChange;
    $[1] = value;
    $[2] = t1;
    $[3] = t2;
  } else {
    t1 = $[2];
    t2 = $[3];
  }
  useEffect(t1, t2);
  let t3;
  if ($[4] !== value) {
    t3 = <output>{value}</output>;
    $[4] = value;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  return t3;
}
