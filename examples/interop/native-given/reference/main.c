// The same calls as `src/main.ts`, written in C: what each member's presence
// must be. The oracle `build.sh` compares the compiled program against.
#include "options.h"

int main(void) {
  options_report("false", (struct options){.keepalive = {true, 0}});
  options_report("empty", (struct options){0});
  options_report("undefined", (struct options){0});
  options_report("all", (struct options){.keepalive = {true, 1}, .priority = {true, 2.5}, .plain = 7});
  options_report("zero", (struct options){.priority = {true, 0}});
  options_report("decided false", (struct options){.keepalive = {true, 0}});
  options_report("decided absent", (struct options){0});
  options_report("held empty", (struct options){0});
  options_report("held false", (struct options){.keepalive = {true, 0}});
  options_report("held zero", (struct options){.priority = {true, 0}});
  return 0;
}
