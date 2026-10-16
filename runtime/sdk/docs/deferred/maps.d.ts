/**
 * @nts/sdk/maps — geography data services. The map *view* is a React
 * component (React layer) built on these types; here are only the parts
 * with no UI: types shared with that component, platform geocoding,
 * and handing off to the system maps app.
 */
import type { Availability, SignalOptions } from "./core.d.ts";

export interface Coordinate {
  readonly latitude: number;
  readonly longitude: number;
}

export interface Region {
  readonly center: Coordinate;
  /** Degrees of latitude / longitude spanned. */
  readonly latitudeDelta: number;
  readonly longitudeDelta: number;
}

export interface Placemark {
  readonly coordinate?: Coordinate;
  readonly name?: string;
  readonly thoroughfare?: string;
  readonly locality?: string;
  readonly administrativeArea?: string;
  readonly postalCode?: string;
  readonly country?: string;
  readonly countryCode?: string;
}

export interface Maps {
  availability(): Promise<Availability>;
  /** Address/place text → places. Online on most platforms; rate-limited by the OS. */
  geocode(query: string, options?: SignalOptions): Promise<readonly Placemark[]>;
  reverseGeocode(coordinate: Coordinate, options?: SignalOptions): Promise<readonly Placemark[]>;
  /** Opens the system maps app at a place/query (linking.open with a maps URL, done right). */
  openInMapsApp(target: Coordinate | string, options?: SignalOptions & { readonly label?: string }): Promise<boolean>;
}

export declare const maps: Maps;
