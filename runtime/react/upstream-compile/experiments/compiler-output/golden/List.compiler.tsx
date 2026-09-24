import { c as _c } from "react/compiler-runtime";
type Item = {
  id: number;
  label: string;
};
type Props = {
  items: readonly Item[];
};
export function List(t0) {
  const $ = _c(4);
  const {
    items
  } = t0;
  let t1;
  if ($[0] !== items) {
    t1 = items.map(_temp);
    $[0] = items;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const rows = t1;
  let t2;
  if ($[2] !== rows) {
    t2 = <list>{rows}</list>;
    $[2] = rows;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  return t2;
}
function _temp(item) {
  return <row key={item.id} label={item.label} />;
}
