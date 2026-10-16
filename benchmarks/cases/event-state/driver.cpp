#include "harness.h"

// The generated program is C, so its symbols are C.
extern "C" {
    double event(double seed);
    void module__init(void);
    void nts_checkpoint(void);
    void nts_process_start(void);
}

// One call is one event, and a host checkpoints after an event. The generated
// default driver calls the export and nothing else, so its run would hold one
// checkpoint for millions of events and never see what this case is for.
//
// Module state is initialised once, as the generated driver does: the table
// is the workload's state, not its work. So is the process's allocator policy,
// which a standalone program's `main` sets first.
double bench_run(void) {
    static int ready = 0;
    if (!ready) {
        ready = 1;
        nts_process_start();
        module__init();
    }
    volatile double seed = 3;
    const double result = event(seed);
    nts_checkpoint();
    return result;
}
