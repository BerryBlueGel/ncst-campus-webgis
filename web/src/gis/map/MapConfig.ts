import { coordinates } from "../coordinate/CampusCoordinateService";
import type { CameraState } from "../../types/gis";
export const CAMPUS_CENTER = coordinates.localToWgs84([970, 1000]);
export const DEFAULT_CAMERA: CameraState = {
  lng: CAMPUS_CENTER[0],
  lat: CAMPUS_CENTER[1],
  zoom: 15.6,
  pitch: 0,
  bearing: 0,
};
export function readCamera(params: URLSearchParams): CameraState {
  const limits: Record<keyof CameraState, [number, number]> = {
    lng: [-180, 180],
    lat: [-85, 85],
    zoom: [2, 20],
    pitch: [0, 70],
    bearing: [-180, 180],
  };
  const result = { ...DEFAULT_CAMERA };
  for (const key of Object.keys(limits) as (keyof CameraState)[]) {
    const raw = params.get(key);
    const value = Number(raw);
    const [min, max] = limits[key];
    if (
      raw !== null &&
      raw.trim() !== "" &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max
    )
      result[key] = value;
  }
  return result;
}
export function cameraQuery(camera: CameraState): Record<string, string> {
  return Object.fromEntries(
    Object.entries(camera).map(([key, value]) => [
      key,
      value.toFixed(key === "lng" || key === "lat" ? 7 : 2),
    ]),
  );
}
