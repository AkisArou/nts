#include <acme.h>

// C++ calling TypeScript through a C ABI. Nothing here knows that.
int main() {
    acme_remember("opened", "1");
    acme_notify("welcome", "Acme", "Thanks for installing.");
    return 0;
}
