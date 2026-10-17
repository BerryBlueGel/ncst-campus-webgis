import type { FeatureCollection, Geometry, Position } from 'geojson';
import { coordinates } from '../coordinate/CampusCoordinateService';
export const STAT_LAYERS = [
  { key: 'buildings', mapId: 'buildings', name: '建筑' },
  { key: 'roads', mapId: 'roads', name: '道路' },
  { key: 'green_areas', mapId: 'green-areas', name: '绿地' },
  { key: 'waterways', mapId: 'waterways', name: '水体' },
  { key: 'sports', mapId: 'sports', name: '体育设施' },
  { key: 'landmarks', mapId: 'landmarks', name: '地标' },
  { key: 'pois', mapId: 'poi', name: '兴趣点' },
  { key: 'campus_boundary', mapId: 'campus-boundary', name: '校园边界' },
] as const;
export interface StatsOverview {
  totalFeatures: number; buildingCount: number; sportsCount: number;
  roadLengthMeters: number; greenAreaSquareMeters: number; waterAreaSquareMeters: number;
  layers: { layer: string; featureCount: number }[];
}
export interface DashboardStats extends StatsOverview {
  campusAreaSquareMeters: number; source: 'api' | 'static'; loadedAt: string;
}
export type StatsCollections = Record<string, FeatureCollection>;
function planar(point: Position): [number, number] { return coordinates.wgs84ToLocal([point[0]!, point[1]!]); }
function ringArea(ring: Position[]): number {
  const points = ring.map(planar);
  return Math.abs(points.reduce((sum, point, i) => {
    const next = points[(i + 1) % points.length]!;
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
}
function polygonArea(rings: Position[][]): number {
  return rings.length ? Math.max(0, ringArea(rings[0]!) - rings.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0)) : 0;
}
export function projectedArea(geometry: Geometry | null): number {
  if (geometry?.type === 'Polygon') return polygonArea(geometry.coordinates);
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.reduce((sum, rings) => sum + polygonArea(rings), 0);
  return 0;
}
function lineLength(line: Position[]): number {
  const points = line.map(planar);
  return points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point[0] - points[i]![0], point[1] - points[i]![1]), 0);
}
export function projectedLength(geometry: Geometry | null): number {
  if (geometry?.type === 'LineString') return lineLength(geometry.coordinates);
  if (geometry?.type === 'MultiLineString') return geometry.coordinates.reduce((sum, line) => sum + lineLength(line), 0);
  return 0;
}
export function collectionArea(collection: FeatureCollection): number { return collection.features.reduce((sum, feature) => sum + projectedArea(feature.geometry), 0); }
export function calculateStaticStats(collections: StatsCollections): StatsOverview {
  const layers = STAT_LAYERS.map(({ key }) => ({ layer: key, featureCount: collections[key]?.features.length ?? 0 }));
  // Track/pitch geometries belong to the same stadium, not two facilities.
  const tracks = collections.sports?.features.filter(feature => feature.properties?.kind === 'track_envelope') ?? [];
  return {
    layers, totalFeatures: layers.reduce((sum, layer) => sum + layer.featureCount, 0),
    buildingCount: collections.buildings?.features.length ?? 0, sportsCount: tracks.length,
    roadLengthMeters: collections.roads?.features.reduce((sum, feature) => sum + projectedLength(feature.geometry), 0) ?? 0,
    greenAreaSquareMeters: collections.green_areas ? collectionArea(collections.green_areas) : 0,
    waterAreaSquareMeters: collections.waterways ? collectionArea(collections.waterways) : 0,
  };
}
export function validateStats(value: unknown): StatsOverview {
  if (!value || typeof value !== 'object') throw Error('统计接口返回了无效数据');
  const stats = value as StatsOverview;
  for (const key of ['totalFeatures', 'buildingCount', 'sportsCount', 'roadLengthMeters', 'greenAreaSquareMeters', 'waterAreaSquareMeters'] as const) {
    if (!Number.isFinite(stats[key]) || stats[key] < 0) throw Error(`统计字段无效：${key}`);
  }
  if (!Array.isArray(stats.layers) || stats.layers.some(layer => !layer || typeof layer.layer !== 'string' || !Number.isInteger(layer.featureCount) || layer.featureCount < 0)) throw Error('图层统计无效');
  return stats;
}
export function layerFocus(query: unknown): Record<string, boolean> | null {
  if (typeof query !== 'string' || (query !== 'all' && !STAT_LAYERS.some(layer => layer.mapId === query))) return null;
  return Object.fromEntries(STAT_LAYERS.map(layer => [layer.mapId, query === 'all' || layer.mapId === query || layer.mapId === 'campus-boundary']));
}
