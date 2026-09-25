// Tag and attribute names: intrinsic, dashed, namespaced, members; valueless
// attributes; elements as attribute values; fragments; empty containers.
import * as UI from "./ui";

export function Names({ on }: { on: boolean }) {
  return (
    <>
      <svg xlink:href="#a" data-x="1" aria-hidden disabled={on} className="s">
        {/* a comment */}
        {}
      </svg>
      <my-element class="c" />
      <UI.Panel.Header title="t" />
      <UI.Header title=<UI.Icon /> />
      <></>
      <>{on}</>
      <>
        <b />
        <i />
      </>
    </>
  );
}
