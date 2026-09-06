/* The synchronous native settings used to initialise `node:net`. */
#ifndef NTS_NODE_NET_H
#define NTS_NODE_NET_H

#include "nts_runtime.h"

bool nts_net_default_auto_select_family(void);
double nts_net_default_auto_select_family_attempt_timeout(void);

#endif
