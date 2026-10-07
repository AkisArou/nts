// The 2D canvas's hand-written members: those whose IDL types the generator
// does not bind. getContext answers a union of every context kind, and
// fillStyle and strokeStyle are `any` in Blink's IDL. Everything else on
// CanvasRenderingContext2D is generated (the allowlist's "modules").
#include "nts/dom_context.h"

#include <string_view>

#include "third_party/blink/renderer/core/html/canvas/canvas_context_creation_attributes_core.h"
#include "third_party/blink/renderer/core/html/canvas/canvas_rendering_context.h"
#include "third_party/blink/renderer/core/html/canvas/html_canvas_element.h"
#include "third_party/blink/renderer/modules/canvas/canvas2d/canvas_gradient.h"
#include "third_party/blink/renderer/modules/canvas/canvas2d/canvas_rendering_context_2d.h"
#include "third_party/blink/renderer/platform/bindings/dom_wrapper_world.h"
#include "third_party/blink/renderer/platform/bindings/v8_binding.h"

namespace {

// `fillStyle = value` as page script's binding sets it: Blink's setter takes
// the V8 value, parses a color string (and caches the parse by string), or
// unwraps a gradient. The value is made in the main world, as page script's
// would be.
using StyleSetter = void (blink::Canvas2DRecorderContext::*)(
    v8::Isolate *, v8::Local<v8::Value>, blink::ExceptionState &);

void SetStyleText(NtsDomCanvasRenderingContext2D *self,
                  const NtsBorrowedString *value, StyleSetter setter,
                  NtsDomException **error) {
  NtsDomContext &context = nts_dom::Current();
  Throws exception_state(error);
  v8::Isolate *isolate = context.v8_isolate.get();
  auto *receiver = ObjectOf<blink::CanvasRenderingContext2D>(self);
  (receiver->*setter)(isolate,
                      blink::V8String(isolate, NtsText(context, value).Text()),
                      exception_state);
}

void SetStyleGradient(NtsDomCanvasRenderingContext2D *self,
                      NtsDomCanvasGradient *value, StyleSetter setter,
                      NtsDomException **error) {
  NtsDomContext &context = nts_dom::Current();
  Throws exception_state(error);
  blink::ScriptState *script_state = context.MainWorld();
  blink::ScriptState::Scope script_scope(script_state);
  auto *receiver = ObjectOf<blink::CanvasRenderingContext2D>(self);
  (receiver->*setter)(context.v8_isolate.get(),
                      ObjectOf<blink::CanvasGradient>(value)->ToV8(script_state),
                      exception_state);
}

} // namespace

extern "C" {

// `canvas.getContext("2d")`, as HTMLCanvasElementModule::getContext answers
// it with no attributes: the canvas's 2D context, made on first use; null if
// the canvas already has a context of another kind.
NtsDomCanvasRenderingContext2D *
nts_dom_HTMLCanvasElement_getContext_2d(NtsDomHTMLCanvasElement *self,
                                        const char *context_id,
                                        NtsDomException **error) {
  NtsDomContext &context = nts_dom::Current();
  Throws exception_state(error);
  auto *canvas = ObjectOf<blink::HTMLCanvasElement>(self);
  if (canvas->IsOffscreenCanvasRegistered()) {
    static_cast<blink::ExceptionState &>(exception_state)
        .ThrowDOMException(blink::DOMExceptionCode::kInvalidStateError,
                           "Cannot get context from a canvas that has "
                           "transferred its control to offscreen.");
    return nullptr;
  }
  if (std::string_view(context_id) != "2d")
    return nullptr;
  blink::CanvasRenderingContext *rendering = canvas->GetCanvasRenderingContext(
      context.document->GetExecutionContext(), blink::String("2d"),
      blink::CanvasContextCreationAttributesCore());
  if (!rendering || !rendering->IsRenderingContext2D())
    return nullptr;
  return HandleOf<NtsDomCanvasRenderingContext2D>(
      static_cast<blink::CanvasRenderingContext2D *>(rendering));
}

void nts_dom_CanvasRenderingContext2D_set_fillStyle_string(
    NtsDomCanvasRenderingContext2D *self, const NtsBorrowedString *value,
    NtsDomException **error) {
  SetStyleText(self, value, &blink::Canvas2DRecorderContext::setFillStyle,
               error);
}
void nts_dom_CanvasRenderingContext2D_set_strokeStyle_string(
    NtsDomCanvasRenderingContext2D *self, const NtsBorrowedString *value,
    NtsDomException **error) {
  SetStyleText(self, value, &blink::Canvas2DRecorderContext::setStrokeStyle,
               error);
}
void nts_dom_CanvasRenderingContext2D_set_fillStyle_gradient(
    NtsDomCanvasRenderingContext2D *self, NtsDomCanvasGradient *value,
    NtsDomException **error) {
  SetStyleGradient(self, value, &blink::Canvas2DRecorderContext::setFillStyle,
                   error);
}
void nts_dom_CanvasRenderingContext2D_set_strokeStyle_gradient(
    NtsDomCanvasRenderingContext2D *self, NtsDomCanvasGradient *value,
    NtsDomException **error) {
  SetStyleGradient(self, value,
                   &blink::Canvas2DRecorderContext::setStrokeStyle, error);
}

} // extern "C"
