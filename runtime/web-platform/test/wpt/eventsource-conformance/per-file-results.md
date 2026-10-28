# Per-file EventSource WPT results

P/F/B means pass / fail / explicit block. The baseline enables all 79 registrations. The final profile fixes four unsupported-scheme failures and records three Fetch CORS failures as named blocks, not passes.

| File | Before P/F/B | After P/F/B |
| --- | ---: | ---: |
| `eventsource/dedicated-worker/eventsource-constructor-no-new.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/dedicated-worker/eventsource-eventtarget.worker.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/event-data.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/eventsource-close.window.js` | 2 / 0 / 0 | 2 / 0 / 0 |
| `eventsource/eventsource-constructor-empty-url.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/eventsource-constructor-non-same-origin.window.js` | 0 / 4 / 0 | 4 / 0 / 0 |
| `eventsource/eventsource-constructor-stringify.window.js` | 4 / 0 / 0 | 4 / 0 / 0 |
| `eventsource/eventsource-constructor-url-bogus.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/eventsource-cross-origin-redirect-origin.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/eventsource-cross-origin.window.js` | 3 / 3 / 0 | 3 / 0 / 3 |
| `eventsource/eventsource-eventtarget.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/eventsource-onmessage-trusted.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/eventsource-onmessage.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/eventsource-onopen.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/eventsource-reconnect.window.js` | 2 / 0 / 0 | 2 / 0 / 0 |
| `eventsource/eventsource-url.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-bom-2.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-bom-split.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-bom-utf-16.any.js` | 2 / 0 / 0 | 2 / 0 / 0 |
| `eventsource/format-bom.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-comments.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-data-before-final-empty-line.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-field-data.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-field-event-empty.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-field-event.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-field-id-2.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-field-id-3.window.js` | 3 / 0 / 0 | 3 / 0 / 0 |
| `eventsource/format-field-id-null.window.js` | 5 / 0 / 0 | 5 / 0 / 0 |
| `eventsource/format-field-id-redirect.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-field-id.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-field-parsing.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-field-retry-empty.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-field-unknown.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-leading-space.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-mime-bogus.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-mime-trailing-semicolon.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-mime-valid-bogus.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-newlines.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-null-character.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/format-utf-8.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/request-accept.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| `eventsource/request-cache-control.any.js` | 4 / 0 / 0 | 4 / 0 / 0 |
| `eventsource/request-credentials.window.js` | 3 / 0 / 0 | 3 / 0 / 0 |
| `eventsource/request-redirect.window.js` | 4 / 0 / 0 | 4 / 0 / 0 |
| `eventsource/request-status-error.window.js` | 7 / 0 / 0 | 7 / 0 / 0 |
| **Total: 45 files** | **72 / 7 / 0** | **76 / 0 / 3** |
