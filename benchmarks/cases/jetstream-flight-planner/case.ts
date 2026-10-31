// JetStream 3.0 FlightPlanner; source revision
// WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b.
// The original BSD-2-Clause notices remain in every transcribed source file.
import { Benchmark } from "./benchmark.ts";
import { expectedFlightPlans } from "./expectations.ts";

export { diagnostics, GeoLocation, Time } from "./flight-planner.ts";

const benchmark = new Benchmark();

// Observe every plan's linked-list length, without running the source driver's
// post-timing calculations inside its measured route-resolution workload.
function observe(): number {
    let checksum = 0;
    for (const plan of expectedFlightPlans)
        checksum = (checksum * 31 + plan._flightPlan._legCount) >>> 0;
    return checksum;
}

export function work(n: number): number {
    let checksum = 0;
    for (let i = 0; i < n; i++) {
        benchmark.runIteration();
        checksum = (checksum * 31 + observe()) >>> 0;
    }
    return checksum;
}

// Complete original route calculations and original expectations are retained
// for correctness checks outside timing, just as Benchmark.validate does.
export function render(n: number = 1): string {
    if (n <= 0) return "";
    for (let i = 0; i < n; i++) benchmark.runIteration();
    benchmark.validate(n);
    return expectedFlightPlans.map(plan => plan._flightPlan.toString()).join("\n");
}

export const seed = 1;

// Observe every computed double and time without rounding for the independent
// correctness oracle. This is never called by work.
export function details(n: number = 1): string {
    if (n <= 0) return "";
    render(n);
    return JSON.stringify(expectedFlightPlans.map(plan => {
        const legs: string[] = [];
        for (let leg = plan._flightPlan._firstLeg; leg; leg = leg.next) {
            legs.push(JSON.stringify({
                fix: leg.fix, type: leg.type,
                latitude: leg.location?.latitude, longitude: leg.location?.longitude,
                course: leg.course, distance: leg.distance, trueAirspeed: leg.trueAirspeed,
                windDirection: leg.windDirection, windSpeed: leg.windSpeed,
                heading: leg.heading, estGS: leg.estGS,
                startFlightTiming: leg.startFlightTiming, stopFlightTiming: leg.stopFlightTiming,
                engineConfig: leg.engineConfig, fuelFlow: leg.fuelFlow,
                distanceRemaining: leg.distanceRemaining,
                estimatedTimeEnroute: leg.estimatedTimeEnroute?.seconds(),
                estTimeRemaining: typeof leg.estTimeRemaining === "number" ? leg.estTimeRemaining : leg.estTimeRemaining.seconds(),
                estFuel: leg.estFuel, extraTurns: leg.extraTurns, climbTime: leg.climbTime?.seconds()
            }));
        }
        return { name: plan._name, totalTime: plan._flightPlan.totalTime().seconds(), gateTime: plan._flightPlan.gateTime().seconds(), legs };
    }));
}
