import { coordinates, CAMPUS_ORIGIN } from '../coordinate/CampusCoordinateService';

// Coordinate metadata is also displayed in 2D. It must not import a renderer.
const [lng,lat]=coordinates.localToWgs84([0,0]);
export const CampusModelAnchor={utmEasting:CAMPUS_ORIGIN[0],utmNorthing:CAMPUS_ORIGIN[1],lng,lat,altitude:0};
