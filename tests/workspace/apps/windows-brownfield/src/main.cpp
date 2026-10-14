#include <acme.h>

int main() {
    acme_remember("opened", "1");
    acme_notify("welcome", "Acme", "Thanks for installing.");
    return 0;
}
