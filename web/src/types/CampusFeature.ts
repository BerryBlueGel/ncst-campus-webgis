import type { Geometry } from 'geojson';

export type FeatureCategory = 'building' | 'landmark' | 'stadium';
export interface GisBinding { source: string; id: string }
export interface CampusFeature {
  id: string;
  name: string;
  type: string;
  category: FeatureCategory;
  geometry: Geometry;
  centroid: [number, number];
  bounds?: [[number, number], [number, number]];
  description: string;
  properties: Record<string, unknown>;
  modelBinding?: string;
  refined: boolean;
  aliases: string[];
  keywords: string[];
  gisBindings: GisBinding[];
}
