# Deferred portable UI behavior

Things deliberately not in the current `src/shared/ui.d.ts`, recorded
so the next design round starts from the receipt rather than
rediscovering them. When an item is designed, delete it here and add
the component/prop types, examples, and matrix row in the same change.

## Advanced List interactions (v2 candidates)

The current `List` intentionally covers flat and sectioned data,
sticky headers, separators, end-reached loading, and pull-to-refresh.
Deferred because each item below has materially different native
mechanics and needs one carefully stated portable contract:

- **Swipe actions.** Leading/trailing row actions, full-swipe
  activation, destructive confirmation, and a non-gesture alternative
  for desktop pointer/keyboard and assistive technology.
- **Reordering.** Controlled order changes by stable key, drag handles,
  pointer/touch/keyboard operation, and what happens to focus and
  selection after a move.
- **Edit mode.** Entering/leaving edit mode, delete affordances, and
  how it composes with swipe actions without duplicating gestures.
- **Selection models.** Single, multiple, and range selection;
  selected rendering state passed to `renderItem`; selection retention
  across data changes and section moves.
- **Row context actions.** Long-press/context-menu behavior and how it
  relates to the portable `Menu` without making every row a menu host.

Invariants for whichever design we choose: state is controlled and
keyed by stable identity, destructive actions never rely on color or
gesture alone, and every touch gesture has a keyboard/pointer and
assistive-technology path.

## Other deferred UI machinery

- Adaptive app shell/navigation, safe-area and keyboard layout policy:
  revisit with the react-* host implementations, where the platforms'
  real layout guides and navigation machinery are available.
- (Resolved) Yoga Grid styles were added against upstream `main` —
  see yoga-style.md. Named grid lines/areas remain out because
  upstream Yoga does not model them.
