import proj4 from "proj4";
export type XY = readonly [number, number];
export const CAMPUS_CRS = "EPSG:32650";
export const CAMPUS_ORIGIN: XY = [635986.7561034276, 4339716.120350528];
proj4.defs(CAMPUS_CRS, "+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs");
// The CRS pair is fixed. Do not rebuild projection definitions for every vertex.
const campusProjection=proj4(CAMPUS_CRS,"EPSG:4326");
export interface FutureModelTransform {
  blenderToGis(
    point: readonly [number, number, number],
  ): [number, number, number];
}
export class CampusCoordinateService {
  utmToLocal([x, y]: XY): [number, number] {
    return [x - CAMPUS_ORIGIN[0], y - CAMPUS_ORIGIN[1]];
  }
  localToUtm([x, y]: XY): [number, number] {
    return [x + CAMPUS_ORIGIN[0], y + CAMPUS_ORIGIN[1]];
  }
  utmToWgs84(point: XY): [number, number] {
    return campusProjection.forward([...point]) as [number, number];
  }
  wgs84ToUtm(point: XY): [number, number] {
    return campusProjection.inverse([...point]) as [number, number];
  }
  localToWgs84(point: XY): [number, number] {
    return this.utmToWgs84(this.localToUtm(point));
  }
  wgs84ToLocal(point: XY): [number, number] {
    return this.utmToLocal(this.wgs84ToUtm(point));
  }
}
export const coordinates = new CampusCoordinateService();
