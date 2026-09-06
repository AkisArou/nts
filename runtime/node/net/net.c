/* Defaults from Node v24.20.0's EnvironmentOptions. NTS does not currently
 * consume Node engine flags, so there is no per-process override to apply at
 * this boundary. The public setters are maintained by the TypeScript module
 * after these initial values have been read. */
#include "net.h"

bool nts_net_default_auto_select_family(void) { return true; }

double nts_net_default_auto_select_family_attempt_timeout(void) {
    return 250.0;
}
