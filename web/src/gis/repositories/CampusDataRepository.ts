import type { FeatureCollection } from "geojson";
export interface LayerDataResult {
  data: FeatureCollection;
  bytes: number;
  loadMs: number;
}
export interface CampusDataRepository {
  getLayer(url: string, signal?: AbortSignal): Promise<LayerDataResult>;
}
export class StaticCampusDataRepository implements CampusDataRepository {
  async getLayer(url: string, signal?: AbortSignal): Promise<LayerDataResult> {
    const start = performance.now(),
      response = await fetch(url, { signal });
    if (!response.ok) throw Error(`GIS HTTP ${response.status}: ${url}`);
    const text = await response.text(),
      data = JSON.parse(text) as FeatureCollection;
    if (data.type !== "FeatureCollection" || !Array.isArray(data.features))
      throw Error("Invalid GIS collection " + url);
    return {
      data,
      bytes: new TextEncoder().encode(text).length,
      loadMs: performance.now() - start,
    };
  }
}
