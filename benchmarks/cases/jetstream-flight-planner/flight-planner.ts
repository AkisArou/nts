import { _faaAirways, type Airway } from "./airways.ts";
import { _faaWaypoints, type WaypointData } from "./waypoints.ts";

export const diagnostics: string[] = [];

/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
 * Copyright (C) 2016-2017 Michael Saboff. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 */
"use strict";

let earthRadius = 3440; // In nautical miles.
let TwoPI = Math.PI * 2;
let degreeCharacter = "\u00b0";

// The released registration does not load use_unicode.js.
const regExpOptionalUnicodeFlag = "";
export const keywords = { get(str: string): string { return str; } };

function status(text: string)
: void {
    diagnostics.push("Status: " + text);
}

function error(text: string)
: void {
    diagnostics.push("Error: " + text);
}

// Fixed source extensions become typed calls with exactly the same arithmetic.
function toRadians(value: number): number { return value * Math.PI / 180; }
function toDegrees(value: number): number { return value * 180 / Math.PI; }

function distanceFromSpeedAndTime(speed: number, time: Time)
: number {
    return speed * time.hours();
}

let LatRE = new RegExp("^([NS\\-])?(90|[0-8]?\\d)(?:( [0-5]?\\d\\.\\d{0,3})'?|(\\.\\d{0,6})|( ([0-5]?\\d)\" ?([0-5]?\\d)'?))?", "i" + regExpOptionalUnicodeFlag);

function decimalLatitudeFromString(latitudeString: unknown)
: number {
    if (typeof latitudeString != "string")
        return 0;

    let match = latitudeString.match(LatRE);

    if (!match)
        return 0;

    let result = 0;
    let sign = 1;

    if (match![1] && (match![1].toUpperCase() == "S" || match![1] == "-"))
        sign = -1;

    result = Number(match![2]);

    if (result != 90) {
        if (match![3]) {
            // e.g. N37 42.874
            let minutes = Number(match![3]);
            result = result + (minutes / 60);
        } else if (match![4]) {
            // e.g. N37.30697
            let decimalDegrees = Number(match![4]);
            result = result + decimalDegrees;
        } else if (match![5]) {
            // e.g. N37 18" 27'
            let degrees = Number(match![6]);
            let minutes = Number(match![7]);
            result = result + (degrees + minutes / 60) / 60;
        }
    }

    return result * sign;
}

let LongRE = new RegExp("^([EW\\-]?)(180|(?:1[0-7]|\\d)?\\d)(?:( [0-5]?\\d\\.\\d{0,3})|(\\.\\d{0,6})|( ([0-5]?\\d)\" ?([0-5]?\\d)'?)?)", "i" + regExpOptionalUnicodeFlag);

function decimalLongitudeFromString(longitudeString: unknown)
: number {
    if (typeof longitudeString != "string")
        return 0;

    let match = longitudeString.match(LongRE);

    if (!match)
        return 0;

    let result = 0;
    let sign = 1;

    if (match![1] && (match![1].toUpperCase() == "W" || match![1] == "-"))
        sign = -1;

    result = Number(match![2]);

    if (result != 180) {
        if (match![3]) {
            // e.g. W121 53.254
            let minutes = Number(match![3]);
            result = result + (minutes / 60);
        } else if (match![4]) {
            // e.g. W121.8876
            let decimalDegrees = Number(match![4]);
            result = result + decimalDegrees;
        } else if (match![5]) {
            // e.g. W121 53" 15'
            let degrees = Number(match![6]);
            let minutes = Number(match![7]);
            result = result + (degrees + minutes / 60) / 60;
        }
    }

    return result * sign;
}

let TimeRE = new RegExp("^([0-9][0-9]?)(?:\:([0-5][0-9]))?(?:\:([0-5][0-9]))?$");

export class Time
{
    declare _seconds: number;

    constructor(time?: string | number | Date)
    {
        if (time instanceof Date) {
            requireLegacyRound(Math);
            this._seconds = Math.Round(time.valueOf() / 1000);
            return;
        }

        if (typeof time == "string") {
            let match = time.match(TimeRE);

            if (!match) {
                this._seconds = 0;
                return;
            }

            if (match![3]) {
                let hours = parseInt(match![1].toString());
                let minutes = parseInt(match![2].toString());
                let seconds = parseInt(match![3].toString());

                this._seconds = (hours * 60 + minutes) * 60 + seconds;
            } else if (match![2]) {
                let minutes = parseInt(match![1].toString());
                let seconds = parseInt(match![2].toString());

                this._seconds = minutes * 60 + seconds;
            } else
                this._seconds = parseInt(match![1].toString());
            return;
        }

        if (typeof time == "number") {
            this._seconds = Math.round(time);
            return;
        }

        this._seconds = 0;
    }

    add(otherTime: Time)
    : Time {
        return new Time(this._seconds + otherTime._seconds);
    }

    addDate(otherDate: Date)
    : Date {
        return new Date(this._seconds * 1000 + otherDate.valueOf());
    }

    static differenceBetween(time2: Time | Date, time1: Time | Date)
    : Time {
        let seconds1;
        let seconds2;
        if (time1 instanceof Time)
            seconds1 = time1.seconds();
        else {
            requireLegacyRound(Math);
            seconds1 = Math.Round(time1.valueOf() / 1000);
        }

        if (time2 instanceof Time)
            seconds2 = time2.seconds();
        else {
            requireLegacyRound(Math);
            seconds2 = Math.Round(time2.valueOf() / 1000);
        }

        return new Time(seconds2 - seconds1);
    }

    seconds()
    : number {
        return this._seconds;
    }

    minutes()
    : number {
        return this._seconds / 60;
    }

    hours()
    : number {
        return this._seconds / 3600;
    }

    toString()
    : string {
        let result = "";
        let seconds = this._seconds % 60;
        if (seconds < 0) {
            result = "-";
            seconds = -seconds;
        }
        let minutes = this._seconds / 60 | 0;
        let hours = minutes / 60 | 0;
        minutes = minutes % 60;

        if (hours)
            result = result + hours + ":";
        if (minutes < 10 && hours)
            result = result + "0";
        result = result + minutes + ":";
        if (seconds < 10)
            result = result + "0";
        result = result + seconds;

        return result;
    }
}

export class GeoLocation
{
    declare latitude: number;
    declare longitude: number;

    constructor(latitude: number, longitude: number)
    {
        this.latitude = latitude;
        this.longitude = longitude;
    }

    latitudeString()
    : string {
        let latitude = this.latitude;
        let latitudePrefix = "N";
        if (latitude < 0) {
            latitude = -latitude;
            latitudePrefix = "S"
        }
        let latitudeDegrees = Math.floor(latitude);
        let latitudeMinutes = ((latitude - latitudeDegrees) * 60).toFixed(3);
        let latitudeMinutesFiller = Number(latitudeMinutes) < 10 ? " " : "";
        return latitudePrefix + latitudeDegrees + degreeCharacter + latitudeMinutesFiller + latitudeMinutes + "'";
    }

    longitudeString()
    : string {
        let longitude = this.longitude;
        let longitudePrefix = "E";
        if (longitude < 0) {
            longitude = -longitude;
            longitudePrefix = "W"
        }

        let longitudeDegrees = Math.floor(longitude);
        let longitudeMinutes = ((longitude - longitudeDegrees) * 60).toFixed(3);
        let longitudeMinutesFiller = Number(longitudeMinutes) < 10 ? " " : "";
        return longitudePrefix + longitudeDegrees + degreeCharacter + longitudeMinutesFiller + longitudeMinutes + "'";
    }

    distanceTo(otherLocation: GeoLocation)
    : number {
        let dLat = toRadians(otherLocation.latitude - this.latitude);
        let dLon = toRadians(otherLocation.longitude - this.longitude);
        let a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRadians(this.latitude)) * Math.cos(toRadians(otherLocation.latitude)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
        let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return earthRadius * c;
    }
    
    bearingFrom(otherLocation: GeoLocation, magneticVariation?: number)
    : number {
        if (magneticVariation == undefined)
            magneticVariation = 0;

        let dLon = toRadians(this.longitude - otherLocation.longitude);
        let thisLatitudeRadians = toRadians(this.latitude);
        let otherLatitudeRadians = toRadians(otherLocation.latitude);
        let y = Math.sin(dLon) * Math.cos(toRadians(this.latitude));
        let x = Math.cos(otherLatitudeRadians) * Math.sin(thisLatitudeRadians) -
            Math.sin(otherLatitudeRadians) * Math.cos(thisLatitudeRadians) * Math.cos(dLon);
        return (toDegrees(Math.atan2(y, x)) + 720 + magneticVariation) % 360;
    }

    bearingTo(otherLocation: GeoLocation, magneticVariation?: number)
    : number {
        if (magneticVariation == undefined)
            magneticVariation = 0;

        let dLon = toRadians(otherLocation.longitude - this.longitude);
        let thisLatitudeRadians = toRadians(this.latitude);
        let otherLatitudeRadians = toRadians(otherLocation.latitude);
        let y = Math.sin(dLon) * Math.cos(toRadians(otherLocation.latitude));
        let x = Math.cos(thisLatitudeRadians) * Math.sin(otherLatitudeRadians) -
            Math.sin(thisLatitudeRadians) * Math.cos(otherLatitudeRadians) * Math.cos(dLon);
        return (toDegrees(Math.atan2(y, x)) + 720 + magneticVariation) % 360
    }

    locationFrom(bearing: number, distance: number, magneticVariation?: number)
    : GeoLocation {
        if (magneticVariation == undefined)
            magneticVariation = 0;

        let bearingRadians = toRadians(bearing - magneticVariation);
        let thisLatitudeRadians = toRadians(this.latitude);
        let angularDistance = distance / earthRadius;
        let latitudeRadians = Math.asin(Math.sin(thisLatitudeRadians) * Math.cos(angularDistance) +
                                 Math.cos(thisLatitudeRadians) * Math.sin(angularDistance) * Math.cos(bearingRadians));
        let longitudeRadians = toRadians(this.longitude) +
            Math.atan2(Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(thisLatitudeRadians),
                       Math.cos(angularDistance) - Math.sin(thisLatitudeRadians) * Math.sin(latitudeRadians));

        return new GeoLocation(toDegrees(latitudeRadians), toDegrees(longitudeRadians));
    }

    toString()
    : string {
        return "(" + this.latitudeString() + ", " + this.longitudeString() + ")";
    }
}

function findFaaWaypoint(waypoint: string)
: unknown {
    return faaWaypoints[waypoint];
}

class FaaWaypoints
{
    declare static instance: FaaWaypoints | undefined;
    declare waypoints: Record<string, WaypointData>;
    [key: string]: unknown;

    constructor()
    {
        if (!FaaWaypoints.instance) {
            FaaWaypoints.instance = this;
            this.waypoints = _faaWaypoints;
        }

        return FaaWaypoints.instance;
    }

    find(waypoint: string)
    : WaypointData | undefined {
        return this.waypoints[waypoint];
    }
}

FaaWaypoints.instance = undefined;

let faaWaypoints = new FaaWaypoints();

class FaaAirways
{
    declare static instance: FaaAirways | undefined;
    declare airways: Record<string, Airway>;

    constructor()
    {
        if (!FaaAirways.instance) {
            FaaAirways.instance = this;
            this.airways = _faaAirways;
        }

        return FaaAirways.instance;
    }

    isAirway(identifier: string)
    : boolean {
        return !!this.airways[identifier];
    }

    resolveAirway(airwayID: string, entryPoint: string, exitPoint: string)
    : string[] | "" {
        let airway = this.airways[airwayID];

        if (!airway)
            return "";

        let entryIndex = airway.fixes.indexOf(entryPoint);
        let exitIndex = airway.fixes.indexOf(exitPoint);

        if (entryIndex == -1 || exitIndex == -1)
            return "";

        let stride = (entryIndex <= exitIndex) ? 1 : -1;

        let route = [];

        for (let idx = entryIndex; idx != exitIndex; idx = idx + stride)
            route.push(airway.fixes[idx]);

        route.push(airway.fixes[exitIndex]);

        return route;
    }
}

FaaAirways.instance = undefined;

let faaAirways = new FaaAirways();

class UserWaypoints
{
    declare static instance: UserWaypoints | undefined;
    declare waypoints: Record<string, WaypointData>;

    constructor()
    {
        if (!UserWaypoints.instance) {
            UserWaypoints.instance = this;
            this.waypoints = {};
        }

        return UserWaypoints.instance;
    }

    clear()
    : void {
        this.waypoints = {};
    }

    find(waypoint: string)
    : WaypointData | undefined {
        return this.waypoints[waypoint];
    }

    update(name: string, description: string, latitude: string | number, longitude: string | number)
    : void {
        if (typeof latitude == "string")
            latitude = decimalLatitudeFromString(latitude);

        if (typeof longitude == "string")
            longitude = decimalLongitudeFromString(longitude);

        this.waypoints[name.toUpperCase()] = {
            "name": name,
            "description": description,
            "latitude": latitude,
            "longitude": longitude
        };
    }
}

UserWaypoints.instance = undefined;

let userWaypoints = new UserWaypoints();


class EngineConfig
{
    declare type: string;
    declare _fuelFlow: number;
    declare _trueAirspeed: number;
    declare static allConfigs: EngineConfig[];
    declare static allConfigsByType: Record<string, EngineConfig>;
    declare static Taxi: number;
    declare static Runup: number;
    declare static Takeoff: number;
    declare static Climb: number;
    declare static Cruise: number;
    declare static Pattern: number;

    constructor(type: string, fuelFlow: number, trueAirspeed: number)
    {
        this.type = type;
        this._fuelFlow = fuelFlow;
        this._trueAirspeed = trueAirspeed;
    }

    trueAirspeed()
    : number {
        return this._trueAirspeed;
    }

    fuelFlow()
    : number {
        return this._fuelFlow;
    }

    static appendConfig(type: string, fuelFlow: number, trueAirspeed: number)
    : void {
        if (this.allConfigsByType[type]) {
            status("Duplicate Engine configuration: " + type);
            return;
        }

        var newConfig = new EngineConfig(type, fuelFlow, trueAirspeed);
        this.allConfigs.push(newConfig);
        this.allConfigsByType[type] = newConfig;
    }

    static getConfig(n: number)
    : EngineConfig | undefined {
        if (n >= this.allConfigs.length)
            return undefined;

        return this.allConfigs[n];
    }
}

EngineConfig.allConfigs = [];
EngineConfig.allConfigsByType = {};
EngineConfig.Taxi = 0;
EngineConfig.Runup = 1;
EngineConfig.Takeoff = 2;
EngineConfig.Climb = 3;
EngineConfig.Cruise = 4;
EngineConfig.Pattern= 5;

class Waypoint
{
    declare name: string;
    declare type: string;
    declare description: string;
    declare latitude: number;
    declare longitude: number;

    constructor(name: string, type: string, description: string, latitude: number, longitude: number)
    {
        this.name = name;
        this.type = type;
        this.description = description;
        this.latitude = latitude;
        this.longitude = longitude;
    }
}

class Leg
{
    declare previous: Leg | undefined;
    declare next: Leg | undefined;
    declare fix: string;
    declare location: GeoLocation | undefined;
    declare course: number;
    declare distance: number;
    declare trueAirspeed: number;
    declare windDirection: number;
    declare windSpeed: number;
    declare heading: number;
    declare estGS: number;
    declare startFlightTiming: boolean;
    declare stopFlightTiming: boolean;
    declare engineConfig: number;
    declare fuelFlow: number;
    declare distanceRemaining: number;
    declare estimatedTimeEnroute: Time | undefined;
    declare estTimeRemaining: Time | 0;
    declare estFuel: number;
    declare type: string | undefined;
    declare specialUpdateForward: (() => void) | undefined;
    declare climbTime: Time | undefined;
    declare index: number | undefined;
    declare extraTurns: number | undefined;
    declare originalLocation: GeoLocation | undefined;

    constructor(fix: string, location: GeoLocation | undefined)
    {
        this.previous = undefined;
        this.next = undefined;
        this.fix = fix;
        this.location = location;
        this.course = 0;
        this.distance = 0;
        this.trueAirspeed = 0;
        this.windDirection = 0;
        this.windSpeed = 0;
        this.heading = 0;
        this.estGS = 0;
        this.startFlightTiming = false;
        this.stopFlightTiming = false;
        this.engineConfig = EngineConfig.Cruise;
        this.fuelFlow = 0;
        this.distanceRemaining = 0;
        this.estimatedTimeEnroute = undefined;
        this.estTimeRemaining = 0;
        this.estFuel = 0;
    }

    fixName()
    : string {
        return this.fix;
    }

    toString()
    : string {
        return this.fix;
    }

    setPrevious(leg: Leg | undefined)
    : void {
        this.previous = leg;
    }

    previousLeg()
    : Leg | undefined {
        return this.previous;
    }

    setNext(leg: Leg | undefined)
    : void {
        this.next = leg;
    }

    nextLeg()
    : Leg | undefined {
        return this.next;
    }

    setWind(windDirection: number, windSpeed: number)
    : void {
        this.windDirection = windDirection;
        this.windSpeed = windSpeed;
    }

    isSameWind(windDirection: number, windSpeed: number)
    : boolean {
        return this.windDirection == windDirection && this.windSpeed == windSpeed;
    }

    windToString()
    : string {
        if (!this.windSpeed)
            return "";

        return (this.windDirection ? this.windDirection : "360") + "@" + this.windSpeed;
    }

    setTrueAirspeed(trueAirspeed: number)
    : void {
        this.trueAirspeed = trueAirspeed;
    }

    isStandardTrueAirspeed()
    : boolean {

        let engineConfig = EngineConfig.getConfig(this.engineConfig);

        return (this.trueAirspeed == engineConfig!.trueAirspeed());
    }

    trueAirspeedToString()
    : string {
        return this.trueAirspeed + "kts";
    }

    updateDistanceAndBearing(other: GeoLocation)
    : void {
        this.distance = this.location!.distanceTo(other);
        this.course = Math.round(this.location!.bearingFrom(other));
        if (this.estimatedTimeEnroute == undefined && this.estGS != 0) {
            let estimatedTimeEnrouteInSeconds = Math.round(this.distance * 3600 / this.estGS);
            this.estimatedTimeEnroute = new Time(estimatedTimeEnrouteInSeconds);
        }

        if (this.estimatedTimeEnroute!.seconds())
            this.estFuel = this.fuelFlow * this.estimatedTimeEnroute!.hours();
    }

    propagateWind()
    : void {
        let windDirection = this.windDirection;
        let windSpeed = this.windSpeed;

        windDirection = (windDirection + 360) % 360;
        if (!windDirection)
            windDirection = 360;

        for (let currLeg: Leg | undefined = this; currLeg; currLeg = currLeg.nextLeg()) {
            currLeg.windDirection = windDirection;
            currLeg.windSpeed = windSpeed;
            if (currLeg.stopFlightTiming)
                break;
        }
    }

    updateForWind()
    : void {
        if (!this.windSpeed || !this.trueAirspeed) {
            this.heading = this.course;
            this.estGS = this.trueAirspeed;
            return;
        }

        let windDirectionRadians = toRadians(this.windDirection);
        let courseRadians = toRadians(this.course);
        let swc = (this.windSpeed / this.trueAirspeed) * Math.sin(windDirectionRadians - courseRadians);
        if (Math.abs(swc) > 1) {
            status("Wind to strong to fly!");
            return;
        }

        let headingRadians = courseRadians + Math.asin(swc);
        if (headingRadians < 0)
            headingRadians += TwoPI;
        if (headingRadians > TwoPI)
            headingRadians -= TwoPI
        let groundSpeed = this.trueAirspeed * Math.sqrt(1 - swc * swc) -
            this.windSpeed * Math.cos(windDirectionRadians - courseRadians);
        if (groundSpeed < 0) {
            status("Wind to strong to fly!");
            return;
        }

        this.estGS = groundSpeed;
        this.heading = Math.round(toDegrees(headingRadians));
    }

    calculate()
    : void {
        let engineConfig = EngineConfig.getConfig(this.engineConfig);

        if (!this.trueAirspeed)
            this.trueAirspeed = engineConfig!.trueAirspeed();
        this.fuelFlow = engineConfig!.fuelFlow();

        this.updateForWind();
    }

    updateForward()
    : void {
        if (this.specialUpdateForward)
            this.specialUpdateForward();

        let previousLeg = this.previousLeg();
        let havePrevious = true;
        if (!previousLeg) {
            havePrevious = false;
            previousLeg = this;
            if (!this.estimatedTimeEnroute)
                this.estimatedTimeEnroute = new Time(0);
        }

        let thisLegType = this.type;
        if (thisLegType == "Climb" && havePrevious)
            this.location = previousLeg.location;
        else {
            this.updateDistanceAndBearing(previousLeg.location!);
            this.updateForWind();
            let nextLeg = this.nextLeg();
            let previousLegType = previousLeg.type;
            if (havePrevious) {
                if (previousLegType == "Climb") {
                    let climbDistance = distanceFromSpeedAndTime(previousLeg.estGS, previousLeg.climbTime!);
                    if (climbDistance < this.distance) {
                        let climbStartLocation = previousLeg.location!;
                        let climbEndLocation = climbStartLocation.locationFrom(this.course, climbDistance);
                        previousLeg.location = climbEndLocation;
                        previousLeg.updateDistanceAndBearing(climbStartLocation);
                        this.estimatedTimeEnroute = undefined;
                        this.updateDistanceAndBearing(climbEndLocation);
                    } else {
                        status("Not enough distance to climb in leg #" + previousLeg.index);
                    }
                } else if ((thisLegType == "Left" || thisLegType == "Right") && nextLeg && nextLeg.location) {
                    let standardRateCircumference = this.trueAirspeed / 30;
                    let standardRateRadius = standardRateCircumference / TwoPI;
                    let offsetInboundBearing = 360 + previousLeg.course + (thisLegType == "Left" ? -90 : 90);
                    offsetInboundBearing = Math.round((offsetInboundBearing + 360) % 360);
                    // Save original location
                    if (!previousLeg.originalLocation)
                        previousLeg.originalLocation = previousLeg.location;
                    let previousLocation = previousLeg.originalLocation!;
                    let inboundLocation = previousLocation.locationFrom(offsetInboundBearing, standardRateRadius);
                    let bearingToNext = Math.round(nextLeg.location.bearingFrom(previousLocation));
                    let offsetOutboundBearing = bearingToNext + (thisLegType == "Left" ? 90 : -90);
                    offsetOutboundBearing = (offsetOutboundBearing + 360) % 360;
                    let outboundLocation = previousLocation.locationFrom(offsetOutboundBearing, standardRateRadius);
                    let turnAngle = thisLegType == "Left" ? (360 + bearingToNext - previousLeg.course) : (360 + previousLeg.course - bearingToNext);
                    turnAngle = (turnAngle + 360) % 360;
                    let totalDegrees = turnAngle + 360 * this.extraTurns!;
                    let secondsInTurn = Math.round(totalDegrees / 3);
                    this.estimatedTimeEnroute = new Time(Math.round((turnAngle + 360 * this.extraTurns!) / 3));
                    this.estFuel = this.fuelFlow * this.estimatedTimeEnroute!.hours();
                    this.location = outboundLocation;
                    this.distance = distanceFromSpeedAndTime(this.trueAirspeed, this.estimatedTimeEnroute);
                    previousLeg.location = inboundLocation;
                    let prevPrevLeg = previousLeg.previousLeg();
                    if (prevPrevLeg && prevPrevLeg.location) {
                        previousLeg.estimatedTimeEnroute = undefined;
                        previousLeg.updateDistanceAndBearing(prevPrevLeg.location);
                    }
                }
            }
        }
    }

    updateBackward()
    : void {
        let nextLeg = this.nextLeg();

        let distanceRemaining;
        let timeRemaining;

        if (nextLeg) {
            distanceRemaining = nextLeg.distanceRemaining;
            timeRemaining = nextLeg.estTimeRemaining;
        } else {
            distanceRemaining = 0;
            timeRemaining = new Time(0);
        }

        requireTime(timeRemaining);
        if (this.stopFlightTiming || timeRemaining.seconds()) {
            this.distanceRemaining = distanceRemaining + this.distance;;
            this.estTimeRemaining = timeRemaining.add(this.estimatedTimeEnroute!);
        } else
            this.estTimeRemaining = new Time(0);
    }
}

let RallyLegWithFixRE = new RegExp("^([0-9a-z\.]{3,16})\\|(" + keywords.get("START") + "|" + keywords.get("TIMING") + ")", "i" + regExpOptionalUnicodeFlag);

class RallyLeg extends Leg
{
    declare type: string;
    declare static startLocation: GeoLocation | undefined;
    declare static startFix: string;
    declare static totalTaxiTime: Time;
    declare static taxiSegments: TaxiLeg[];

    constructor(type: string, fix: string, location: GeoLocation | undefined, engineConfig: number)
    {
        super(fix, location);
        this.type = type;
        this.engineConfig = engineConfig;
    }

    fixName()
    : string {
        return this.type;
    }

    toString()
    : string {
        return this.fixName();
    }

    static reset()
    : void {
        RallyLeg.startLocation = undefined;
        RallyLeg.startFix = "";
        RallyLeg.totalTaxiTime = new Time(0);
        RallyLeg.taxiSegments = [];
    }

    static fixNeeded(fix: string)
    : string {
        let match = fix.match(RallyLegWithFixRE);

        if (!match)
            return "";

        return match![1].toString();
    }

    static getLegWithFix(waypointText: string, fix: string, location: GeoLocation | undefined)
    : StartLeg | TimingLeg | undefined {
        let match = waypointText.match(RallyLegWithFixRE);

        if (!match)
            return undefined;

        let legType = match![2].toString();

        if (legType == keywords.get("START")) {
            if (this.startLocation) {
                status("Trying to create second start leg");
                return undefined;
            }

            this.startLocation = location;
            this.startFix = fix;
            this.totalTaxiTime = new Time(0);
            this.taxiSegments = [];

            return new StartLeg(waypointText, fix, location);
        }

        if (legType == keywords.get("TIMING"))
            return new TimingLeg(waypointText, fix, location);


        error("Unhandled Rally Leg type " + legType);
        return undefined;
    }
}

RallyLeg.startLocation = undefined;
RallyLeg.startFix = "";
RallyLeg.totalTaxiTime = new Time(0);
RallyLeg.taxiSegments = [];

class StartLeg extends RallyLeg
{
    constructor(fixText: string, fix: string, location: GeoLocation | undefined)
    {
        super("Start", fix, location, EngineConfig.Taxi);
    }

    fixName()
    : string {
        return this.fix + "|Start";
    }
}

class TimingLeg extends RallyLeg
{
    constructor(fixText: string, fix: string, location: GeoLocation | undefined)
    {
        super("Timing", fix, location, EngineConfig.Cruise);
        this.stopFlightTiming = true;
    }

    fixName()
    : string {
        return this.fix + "|Timing";
    }
}

let RallyLegNoFixRE = new RegExp(keywords.get("TAXI") + "|" + keywords.get("RUNUP") + "|" + keywords.get("TAKEOFF") + "|" + keywords.get("CLIMB") + "|" + keywords.get("PATTERN") + "|" + keywords.get("LEFT") + "|" + keywords.get("RIGHT"), "i" + regExpOptionalUnicodeFlag);

class RallyLegWithoutFix extends RallyLeg
{
    constructor(type: string, CommentsAsFix: string, location: GeoLocation | undefined, engineConfig: number)
    {
        super(type, CommentsAsFix, location, engineConfig);
    }

    setPrevious(previous: Leg | undefined)
    : void {
        if (this.setLocationFromPrevious() && previous)
            this.location = previous.location;

        super.setPrevious(previous);
    }

    setLocationFromPrevious()
    : boolean {
        return false;
    }

    static isRallyLegWithoutFix(fix: string)
    : boolean {
        let barPosition = fix.indexOf("|");
        let firstPart = barPosition < 0 ? fix : fix.substring(0, barPosition);

        return RallyLegNoFixRE.test(firstPart);
    }

    static getLegNoFix(waypointText: string)
    : RallyLegWithoutFix | undefined {
        let barPosition = waypointText.indexOf("|");
        let firstPart = barPosition < 0 ? waypointText : waypointText.substring(0, barPosition);
        firstPart = firstPart.toUpperCase();

        let match = firstPart.match(RallyLegNoFixRE);

        if (!match)
            return undefined;

        let legType = match![0].toString();

        if (legType == keywords.get("TAXI"))
            return new TaxiLeg(waypointText);

        if (legType == keywords.get("RUNUP"))
            return new RunupLeg(waypointText);

        if (legType == keywords.get("TAKEOFF")) {
            if (!this.startLocation) {
                status("Trying to create a Takeoff leg without start leg");
                return undefined;
            }

            return new TakeoffLeg(waypointText);
        }

        if (legType == keywords.get("CLIMB"))
            return new ClimbLeg(waypointText);

        if (legType == keywords.get("PATTERN"))
            return new PatternLeg(waypointText);

        if (legType == keywords.get("LEFT") || legType == keywords.get("RIGHT"))
            return new TurnLeg(waypointText, legType == keywords.get("RIGHT"));

        error("Unhandled Rally Leg type " + legType);
        return undefined;
    }
}

// TAXI[|<time>]  e.g. TAXI|2:30
let TaxiLegRE = new RegExp("^" + keywords.get("TAXI") + "(?:\\|([0-9][0-9]?(?:\:[0-5][0-9])?))?$", "i" + regExpOptionalUnicodeFlag);

class TaxiLeg extends RallyLegWithoutFix
{
    constructor(fixText: string)
    {
        let match = fixText.match(TaxiLegRE);

        super("Taxi", "", new GeoLocation(-1, -1), EngineConfig.Taxi);

        let taxiTimeString = "5:00";
        if (match![1])
            taxiTimeString = match![1].toString();

        this.estimatedTimeEnroute = new Time(taxiTimeString);
    }

    setLocationFromPrevious()
    : boolean {
        return true;
    }    

    fixName()
    : string {
        return "Taxi|" + this.estimatedTimeEnroute!.toString();
    }
}

// RUNUP[|<time>]  e.g. RUNUP|0:30
let RunupLegRE = new RegExp("^" + keywords.get("RUNUP") + "(?:\\|([0-9][0-9]?(?:\:[0-5][0-9])?))?$", "i" + regExpOptionalUnicodeFlag);

class RunupLeg extends RallyLegWithoutFix
{
    constructor(fixText: string)
    {
        let match = fixText.match(RunupLegRE);

        super("Runup", "", new GeoLocation(-1, -1), EngineConfig.Runup);

        let runupTimeString = "30";
        if (match![1])
            runupTimeString = match![1].toString();

        this.estimatedTimeEnroute = new Time(runupTimeString);
    }

    setLocationFromPrevious()
    : boolean {
        return true;
    }    

    fixName()
    : string {
        return "Runup|" + this.estimatedTimeEnroute!.toString();
    }
}

// TAKEOFF[|<time>][|<bearing>|<distance>]  e.g. TAKEOFF|2:00|270@3.5
let TakeoffLegRE = new RegExp("^" + keywords.get("TAKEOFF") + "(?:\\|([0-9][0-9]?(?:\:[0-5][0-9])?))?(?:\\|([0-9]{1,2}|[0-2][0-9][0-9]|3[0-5][0-9]|360)(?:@)(\\d{1,2}(?:\\.\\d{1,4})?))?$", "i" + regExpOptionalUnicodeFlag);

class TakeoffLeg extends RallyLegWithoutFix
{
    declare bearingFromStart: number;
    declare distanceFromStart: number;

    constructor(fixText: string)
    {
        let match = fixText.match(TakeoffLegRE);

        let bearingFromStart = 0;
        let distanceFromStart = 0;
        let takeoffEndLocation = RallyLeg.startLocation;
        if (match && match![2] && match![3]) {
            bearingFromStart = parseInt(match![2].toString()) % 360;
            distanceFromStart = parseFloat(match![3].toString());
            takeoffEndLocation = RallyLeg.startLocation!.locationFrom(bearingFromStart, distanceFromStart);
        }

        super("Takeoff", "", takeoffEndLocation, EngineConfig.Takeoff);

        this.bearingFromStart = bearingFromStart;
        this.distanceFromStart = distanceFromStart;

        let takeoffTimeString = "2:00";
        if (match![1])
            takeoffTimeString = match![1].toString();

        this.estimatedTimeEnroute = new Time(takeoffTimeString);
        this.startFlightTiming = true;
    }

    fixName()
    : string {
        let result = "Takeoff";

        if (this.estimatedTimeEnroute!.seconds() != 120)
            result += "|" + this.estimatedTimeEnroute!.toString();
        if (this.distanceFromStart)
            result += "|" + this.bearingFromStart + "@" + this.distanceFromStart;

        return result;
    }
}

// CLIMB|<alt>|<time>  e.g. CLIMB|5000|7:00
let ClimbLegRE = new RegExp("^" + keywords.get("CLIMB") + "(?:\\|)(\\d{3,5})(?:\\|([0-9][0-9]?(?:\:[0-5][0-9])?))$", "i" + regExpOptionalUnicodeFlag);

class ClimbLeg extends RallyLegWithoutFix
{
    declare altitude: string | number;
    declare climbTime: Time;

    constructor(fixText: string)
    {
        let match = fixText.match(ClimbLegRE);

        let altitude: string | number = 5500;
        if (match && match![1])
            altitude = match![1].toString();

        super("Climb", altitude + "\"", undefined, EngineConfig.Climb);

        let timeToClimb = "8:00";
        if (match && match![2])
            timeToClimb = match![2].toString();

        this.altitude = altitude;
        this.climbTime = this.estimatedTimeEnroute = new Time(timeToClimb);
    }

    setLocationFromPrevious()
    : boolean {
        return true;
    }    

    fixName()
    : string {
        return "Climb|" + this.altitude + "|" + this.estimatedTimeEnroute!.toString();
    }
}

// PATTERN|<time>  e.g. PATTERN|0:30
let PatternLegRE = new RegExp("^" + keywords.get("PATTERN") + "(?:\\|([0-9][0-9]?(?:\:[0-5][0-9])?))$", "i" + regExpOptionalUnicodeFlag);

class PatternLeg extends RallyLegWithoutFix
{
    constructor(fixText: string)
    {
        super("Pattern", "", undefined, EngineConfig.Pattern);

        let match = fixText.match(PatternLegRE);
        let patternTimeString = match![1].toString();
        this.estimatedTimeEnroute = new Time(patternTimeString);
    }

    setLocationFromPrevious()
    : boolean {
        return true;
    }    

    fixName()
    : string {
        return "Pattern|" + this.estimatedTimeEnroute!.toString();
    }
}

// {LEFT,RIGHT}[|+<extra_turns>]  e.g. LEFT|2
let TurnLegRE = new RegExp("^(" + keywords.get("LEFT") + "|" + keywords.get("RIGHT") + ")(?:\\|\\+(\\d))?$", "i");

class TurnLeg extends RallyLegWithoutFix
{
    declare extraTurns: number;

    constructor(fixText: string, isRightTurn: boolean)
    {
        let match = fixText.match(TurnLegRE);

        let direction = "Left";
        if (match && match![1])
            direction = match![1].toString().toUpperCase() == keywords.get("LEFT") ? "Left" : "Right";

        let engineConfig = EngineConfig.Cruise;

        super(direction, "", new GeoLocation(-1, -1), engineConfig);

        this.extraTurns = (match && match![2]) ? parseInt(match![2]) : 0;
    }

    fixName()
    : string {
        let result = this.type;
        if (this.extraTurns)
            result += ("|+" + this.extraTurns);

        return result;
    }
}

let LegModifier = new RegExp("(360|3[0-5][0-9]|[0-2][0-9]{2}|[0-9]{1,2})@([0-9]{1,3})|([1-9][0-9]{1,2}|0)kts", "i");

class FlightPlan
{
    declare _name: string;
    declare _route: string;
    declare _firstLeg: Leg | undefined;
    declare _lastLeg: Leg | undefined;
    declare _legCount: number;
    declare _defaultWindDirection: number;
    declare _defaultWindSpeed: number;
    declare _trueAirspeedOverride: number;
    declare _timeToGate: Time | undefined;
    declare _estimatedTimeEnroute: Time | undefined;
    declare _totalFuel: number;
    declare _totalTime: Time;
    declare _gateTime: Time;

    constructor(name: string, route: string)
    {
        this._name = name;
        this._route = route;
        this._firstLeg = undefined;
        this._lastLeg = undefined;
        this._legCount = 0;
        this._defaultWindDirection = 0;
        this._defaultWindSpeed = 0;
        this._trueAirspeedOverride = 0;
        this._timeToGate = undefined;
        this._estimatedTimeEnroute = undefined;
        this._totalFuel = 0;
        this._totalTime = new Time();
        this._gateTime = new Time();

        RallyLeg.reset();   //  Refactor to make this more OO
    }

    clear()
    : void {
    }

    appendLeg(leg: Leg)
    : void {
        if (!this._firstLeg)
            this._firstLeg = leg;
        if (this._lastLeg)
            this._lastLeg.setNext(leg);
        leg.setPrevious(this._lastLeg);
        leg.setNext(undefined);

        if (this._trueAirspeedOverride) {
            leg.setTrueAirspeed(this._trueAirspeedOverride);
            this.clearTrueAirspeedOverride(0);
        }

        if (this._defaultWindSpeed)
            leg.setWind(this._defaultWindDirection, this._defaultWindSpeed);

        this._lastLeg = leg;
        this._legCount++;
    }

    setDefaultWind(windDirection: number, windSpeed: number)
    : void {
        this._defaultWindDirection = windDirection;
        this._defaultWindSpeed = windSpeed;
    }

    clearTrueAirspeedOverride(ignored?: number): void;
    clearTrueAirspeedOverride()
    : void {
        this._trueAirspeedOverride = 0;
    }

    setTrueAirspeedOverride(trueAirspeed: number)
    : void {
        this._trueAirspeedOverride = trueAirspeed;
    }

    isLegModifier(fix: string)
    : boolean {
        return LegModifier.test(fix);
    }

    processLegModifier(fix: string)
    : void {
        let match = fix.match(LegModifier);

        if (match) {
            if (match![1] && match![2]) {
                let windDirection = parseInt(match![1].toString()) % 360;
                let windSpeed = parseInt(match![2].toString());

                this.setDefaultWind(windDirection, windSpeed);
            } else if (match![3]) {
                let trueAirspeed = parseInt(match![3].toString());
                this.setTrueAirspeedOverride(trueAirspeed);
            }
        }
    }

    resolveWaypoint(waypointText: string)
    : void {
        if (this.isLegModifier(waypointText))
            this.processLegModifier(waypointText);
        else if (RallyLegWithoutFix.isRallyLegWithoutFix(waypointText)) {
            let rallyLeg = RallyLegWithoutFix.getLegNoFix(waypointText);
            if (rallyLeg)
                this.appendLeg(rallyLeg!);
        } else {
            let fixName = RallyLeg.fixNeeded(waypointText);
            let isRallyWaypoint = false;

            if (fixName)
                isRallyWaypoint = true;
            else
                fixName = waypointText;

            let waypoint = userWaypoints.find(fixName);
            if (!waypoint)
                waypoint = faaWaypoints.find(fixName);
            if (!waypoint) {
                error("Couldn't find waypoint \"" + waypointText + "\"");
                return;
            }

            let location = new GeoLocation(waypoint.latitude, waypoint.longitude);

            if (isRallyWaypoint) {
                let rallyLeg = RallyLeg.getLegWithFix(waypointText, fixName, location);
                this.appendLeg(rallyLeg!);
            } else
                this.appendLeg(new Leg(waypoint.name, location));
        }
    }

    parseRoute()
    : void {
        let waypointsToLookup = this._route.split(/ +/);
        let priorWaypoint = "";

        for (let waypointIndex = 0; waypointIndex < waypointsToLookup.length; waypointIndex++) {
            let currentWaypoint = waypointsToLookup[waypointIndex].toUpperCase();
            if (faaAirways.isAirway(currentWaypoint) && (waypointIndex + 1) < waypointsToLookup.length) {
                let exitWaypointFix = waypointsToLookup[waypointIndex + 1];
                let airwayFixes = faaAirways.resolveAirway(currentWaypoint, priorWaypoint, exitWaypointFix);

                // We skip the entry and exit fixes, because they are handled in the prior / next
                // iterations of the outer loop.
                for (let airwayFixIndex = 1; airwayFixIndex < airwayFixes.length - 1; airwayFixIndex++)
                    this.resolveWaypoint(airwayFixes[airwayFixIndex]);
            } else
                this.resolveWaypoint(currentWaypoint);
            
            priorWaypoint = currentWaypoint;
        }
    }

    calculate()
    : void {
        if (!this._firstLeg)
            return;

        let haveStartTiming = false;
        let haveStopTiming = false;
        for (let thisLeg: Leg | undefined = this._firstLeg; thisLeg; thisLeg = thisLeg.nextLeg()) {
            thisLeg.calculate();
            if (thisLeg.startFlightTiming) {
                if (haveStartTiming)
                    status("Have duplicate Start timing leg in row " + thisLeg.toString());
                haveStartTiming = true;
            }
            if (thisLeg.stopFlightTiming) {
                if (haveStopTiming)
                    status("Have duplicate Timing leg in row " + thisLeg.toString());
                haveStopTiming = true;
            }
        }

        if (!haveStartTiming)
            this._firstLeg.startFlightTiming = true;
        if (!haveStopTiming)
            this._lastLeg!.stopFlightTiming = true;

        for (let thisLeg: Leg | undefined = this._firstLeg; thisLeg; thisLeg = thisLeg.nextLeg())
            thisLeg.updateForward();

        for (let thisLeg = this._lastLeg; thisLeg; thisLeg = thisLeg.previousLeg())
            thisLeg.updateBackward();

        for (let thisLeg: Leg | undefined = this._firstLeg; thisLeg; thisLeg = thisLeg.nextLeg()) {
            if (thisLeg.startFlightTiming) {
                requireTime(thisLeg.estTimeRemaining);
                this._gateTime = thisLeg.estTimeRemaining;
            }
        }

        requireTime(this._firstLeg.estTimeRemaining);
        this._totalTime = this._firstLeg.estTimeRemaining;
    }

    resolvedRoute()
    : string {
        let result = "";
        let lastWindDirection = 0;
        let lastWindSpeed = 0;

        let legIndex = 0;
        let currentLeg = this._firstLeg;
        
        for (; currentLeg; currentLeg = currentLeg.nextLeg(), legIndex++) {

            if (legIndex)
                result = result + " ";

            if (!currentLeg.isSameWind(lastWindDirection, lastWindSpeed)) {
                result = result + currentLeg.windToString() + " ";
                lastWindDirection = currentLeg.windDirection;
                lastWindSpeed = currentLeg.windSpeed;
            }

            if (!currentLeg.isStandardTrueAirspeed())
                result = result + currentLeg.trueAirspeedToString() + " ";

            result = result + currentLeg.toString();
        }

        return result;
    }

    name()
    : string {
        return this._name;
    }

    totalTime()
    : Time {
        return this._totalTime;
    }
    
    gateTime()
    : Time {
        return this._gateTime;
    }
    
    toString()
    : string {
        let result = "";
        let lastWindDirection = 0;
        let lastWindSpeed = 0;

        let legIndex = 0;
        let currentLeg = this._firstLeg;
        
        for (; currentLeg; currentLeg = currentLeg.nextLeg(), legIndex++) {

            if (legIndex)
                result = result + " ";

            if (!currentLeg.isSameWind(lastWindDirection, lastWindSpeed)) {
                result = result + currentLeg.windToString() + " ";
                lastWindDirection = currentLeg.windDirection;
                lastWindSpeed = currentLeg.windSpeed;
            }

            if (!currentLeg.isStandardTrueAirspeed())
                result = result + currentLeg.trueAirspeedToString() + " ";

            result = result + currentLeg.toString();
            result = result + " " + currentLeg.location + " " + currentLeg.distance.toFixed(2) + "nm " + currentLeg.estGS.toFixed(2) + "kts " + currentLeg.estimatedTimeEnroute + " ";
        }

        if (this._gateTime)
            result = result + " gate time " + this._gateTime;

        result = result + " total time " + this._firstLeg!.estTimeRemaining;
        return result;
    }
}

EngineConfig.appendConfig("Taxi", 2, 0);
EngineConfig.appendConfig("Runup", 8, 0);
EngineConfig.appendConfig("Takeoff", 27, 105);
EngineConfig.appendConfig("Climb", 22, 125);
EngineConfig.appendConfig("Cruise", 15, 142);
EngineConfig.appendConfig("Pattern", 11, 95);

export class ExpectedFlightPlan
{
    declare _name: string;
    declare _route: string;
    declare _expectedRoute: string;
    declare _expectedTotalTime: Time | undefined;
    declare _expectedGateTime: Time | undefined;
    declare _flightPlan: FlightPlan;

    constructor(name: string, route: string, expectedRoute: string, expectedTotalTime: Time | undefined, expectedGateTime: Time | undefined)
    {
        this._name = name;
        this._route = route;
        this._expectedRoute = expectedRoute;
        this._expectedTotalTime = expectedTotalTime;
        this._expectedGateTime = expectedGateTime;
    }

    reset()
    : void {
        this._flightPlan = new FlightPlan(this._name, this._route);
    }

    resolveRoute()
    : void {
        this._flightPlan.parseRoute();
    }

    calculate()
    : void {
        this._flightPlan.calculate();
    }

    checkExpectations()
    : void {
        if (this._expectedRoute) {
            let computedRoute = this._flightPlan.resolvedRoute();
            if (this._expectedRoute != computedRoute)
                error("Flight plan " + this._flightPlan.name() + " route different than expected (\"" +
                      this._expectedRoute + "\"), got (\"" + computedRoute + "\")");
        }

        if (this._expectedTotalTime) {
            let computedTotalTime = this._flightPlan.totalTime();
            let deltaTime = Math.abs(Time.differenceBetween(this._expectedTotalTime, computedTotalTime).seconds());
            if (deltaTime > 5)
                error("Flight plan " + this._flightPlan.name() + " total time different than expected (" +
                      this._expectedTotalTime + "), got (" + computedTotalTime + ")");
        }

        if (this._expectedGateTime) {
            let computedGateTime = this._flightPlan.gateTime();
            let deltaTime = Math.abs(Time.differenceBetween(this._expectedGateTime, computedGateTime).seconds());
            if (deltaTime > 5)
                error("Flight plan " + this._flightPlan.name() + " gate time different than expected (" +
                      this._expectedGateTime + "), got (" + computedGateTime + ")");
        }
    }
}

export function setupUserWaypoints()
: void {
    userWaypoints.clear();   
    userWaypoints.update("Oilcamp", "Oil storage in the middle of no where", "36.68471", "-120.50277");
    userWaypoints.update("I5.Westshields", "I5 & West Shields", "36.77774", "-120.72426");
    userWaypoints.update("I5.165", "Intersection of I5 and CA165", "36.93022", "-120.84068");
    userWaypoints.update("I5.VOLTA", "I5 & Volta Road", "37.01419", "-120.92878");
    userWaypoints.update("PT.ALPHA", "Intersection of I5 and CA152", "37.05665", "-120.96990");
    userWaypoints.update("Jellysferry", "Jelly's Ferry bridge across Sacramento River", "N40 19.037", "W122 11.359");
    userWaypoints.update("Howie", "RDD Timing Point", "N40 21.893", "W122 13.042");
    userWaypoints.update("Hale", "2014 Leg 1 Timing", "N39 33.621", "W119 14.438");
    userWaypoints.update("Winnie", "2014 Leg 2 Timing", "N40 50.499", "W114 12.595");
    userWaypoints.update("WindRiver", "2014 Leg 3 Timing", "N42 43.733", "W108 38.800");
    userWaypoints.update("Buff", "2014 Leg 4 Timing", "N43 59.455", "W103 16.171");
    userWaypoints.update("Omega", "2014 Leg 5 Timing", "N44 53.388", "W95 38.935");
    userWaypoints.update("Paul", "2014 Leg 6 Timing", "N43 22.027", "W89 37.111");
    userWaypoints.update("MicrowaveSt", "2014 Microwave Station", "N40 24.89", "W117 12.37");
    userWaypoints.update("RanchTower", "2014 Ranch/Tower", "N41 6.16", "W115 5.43");
    userWaypoints.update("FremontIsland", "2014 Fremont Island", "N41 10.49", "W112 20.64");
    userWaypoints.update("Tremonton", "2014 Tremonton", "N41 42.86", "W112 11.05");
    userWaypoints.update("RandomPoint", "2014 Random Point", "N42", "W111 03");
    userWaypoints.update("Farson", "2014 Farson", "N42 6.40", "W109 26.95");
    userWaypoints.update("Midwest", "2014 Midwest", "N43 24.49", "W109 16.68");
    userWaypoints.update("Bill", "2014 Bill", "N43 13.96", "W105 15.60");
    userWaypoints.update("MMNHS", "2014 MMNHS", "N43 52.67", "W101 57.65");
    userWaypoints.update("Tracks", "2014 Tracks", "N44 21", "W100 22");
    userWaypoints.update("Towers", "2014 Towers", "N43 34.25", "W92 25.64");
    userWaypoints.update("IsletonBridge", "Isleton Bridge", "N38 10.32", "W121 35.62");
    userWaypoints.update("Mystery15", "2015 Mystery", "N38 46.22", "W122 34.25");
    userWaypoints.update("Paskenta", "Paskenta Town", "N39 53.13", "W122 32.36");
    userWaypoints.update("Bonanza", "Bonanza Town", "N42 12.15", "W121 24.53");
    userWaypoints.update("Silverlake", "Silverlake", "N43 07.41", "W121 03.74");
    userWaypoints.update("Millican", "Bend Timing Start", "N43 52.75", "W120 55.13");
    userWaypoints.update("Goering", "Bend Timing", "N44 05.751", "W120 56.834");
    userWaypoints.update("Constantia2", "Our Constantia Wpt", "N39 56.068", "W120 0.831");
    userWaypoints.update("Hallelujah2", "Reno Timing", "N39 46.509", "W120 2.336");
    userWaypoints.update("Redding.Pond", "Pond 6nm North of KRDD", "N40 36", "W122 17");
    userWaypoints.update("Thunderhill", "Thunder Hill Race Track", "N39 32.36", "W122 19.83");
    userWaypoints.update("CascadeHighway", "Cascade Wonderland Highway", "N40 46.63", "W122 19.12");
    userWaypoints.update("Eagleville", "Eagleville closed airport", "N41 18.73", "W120 3.00");
    userWaypoints.update("DuckLakePass", "Saddle near Duck Lake", "N41 3.00", "W120 3.00");
}

// The unused source-fixture printer createTestRoutes is not linked into this row.

// createTestRoutes();

// These guards express the source's phase invariants without a cast. They run
// only in validation or dormant Date helpers, never in route parsing.
function requireTime(value: Time | 0): asserts value is Time {
    if (!(value instanceof Time)) throw new TypeError("Expected calculated Time");
}

// The original has a dormant Math.Round misspelling. Preserve its TypeError
// for Date inputs rather than silently repairing it to Math.round.
function requireLegacyRound(value: typeof Math): asserts value is typeof Math & { Round(n: number): number } {
    if (!("Round" in value) || typeof value.Round !== "function")
        throw new TypeError("Math.Round is not a function");
}
