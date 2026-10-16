# Style cross-check against Yoga upstream `main`

`Style` in `src/shared/ui.d.ts` was cross-checked setter-by-setter
against Yoga upstream `main` on 2026-10-16 — the version this project
will vendor — using upstream `yoga/style/Style.h`, the Grid headers,
and `YGEnums.h`. This includes the Grid surface added upstream after
the 3.2.1 stable baseline. No Yoga version is vendored by this repo
yet, so the implementation round must record the exact upstream
commit it embeds and regenerate this table if that commit differs.

| Yoga upstream Style member | Portable `Style` spelling | Notes |
|---|---|---|
| `direction` | `direction` | `inherit \| ltr \| rtl` |
| `flexDirection` | `flexDirection` | includes both reverses |
| `justifyContent` | `justifyContent` | full Yoga `Justify` set, including `stretch`, `start`, `end`, `space-evenly` |
| `justifyItems`, `justifySelf` | same names | Grid/main additions beyond 3.2.1 |
| `alignContent` | `alignContent` | full Yoga `Align` distribution set |
| `alignItems` | `alignItems` | |
| `alignSelf` | `alignSelf` | plus `auto` |
| `positionType` | `position` | CSS name: `static \| relative \| absolute` |
| `flexWrap` | `flexWrap` | includes `wrap-reverse` |
| `overflow` | `overflow` | `visible \| hidden \| scroll` |
| `display` | `display` | upstream: `flex \| none \| contents \| grid` |
| `flex` | `flex` | **Portable semantics differ on purpose:** positive means grow=value, shrink=1, basis=0 (React Native/web reading). Translators must not pass it to Yoga `setFlex`, whose shorthand treats a negative value as shrink |
| `flexGrow`, `flexShrink`, `flexBasis` | same names | `flexBasis` accepts points, `%`, `auto` |
| `margin(Edge)` | `margin`, `marginHorizontal/Vertical`, `marginTop/Right/Bottom/Left`, `marginStart/End` | all accept points, `%`, `auto` |
| `position(Edge)` | `top`, `right`, `bottom`, `left`, `start`, `end` | points, `%`, `auto` |
| `padding(Edge)` | `padding`, `paddingHorizontal/Vertical`, per-edge and start/end forms | points and `%` |
| `border(Edge)` | `borderWidth`, per-edge and start/end width forms | widths are points; color is paint, below |
| `gap(Gutter)` | `gap`, `rowGap`, `columnGap` | points and `%` |
| `gridTemplateColumns/Rows`, `gridAutoColumns/Rows` (and per-index setters) | same names as whole-list properties | array form maps to Yoga `GridTrackList`; string form is CSS track syntax without named lines |
| `gridColumnStart/End`, `gridRowStart/End` | same names | integer line, `auto`, or `span N`; named lines unsupported by Yoga |
| `dimension(axis)` | `width`, `height` | points, `%`, `auto`, `max-content`, `fit-content`, `stretch` |
| `minDimension`, `maxDimension` | `minWidth/Height`, `maxWidth/Height` | same size-keyword set as dimensions |
| `aspectRatio` | `aspectRatio` | numeric width/height ratio |
| `boxSizing` | `boxSizing` | `border-box \| content-box` |

Portable defaults are Yoga's, not the browser's, so native hosts and
the DOM host must set them explicitly rather than inheriting engine
defaults: `flexDirection: column`, `flexShrink: 0`,
`alignContent: flex-start`, `alignItems: stretch`,
`position: relative`, `display: flex`, `boxSizing: border-box`.
Do not enable Yoga's `UseWebDefaults` for portable trees; it changes
several of those and would make the same style lay out differently
per host.

Not Yoga properties (renderer paint, never sent to Yoga):
`backgroundColor`, `backgroundImage`, `backgroundSize`,
`backgroundPosition`, `backgroundRepeat`, `borderColor`,
`borderRadius`, `opacity`, and the text properties. React Native
0.88 made the unprefixed background size/position/repeat names
stable; we adopt those CSS names and value grammar from the start,
with no prefixed aliases to remove later.

Not in upstream Yoga's Grid surface, so not added here: named grid
lines/areas and `gridAutoFlow` (auto-placement is implicit in the
upstream algorithm at the checked revision). If upstream gains them,
they enter through this same cross-check, not by guessing CSS names.
