import type { CampusFeature, FeatureCategory } from '../../types/CampusFeature';
export interface FeatureRepository {
  load(signal?: AbortSignal): Promise<void>;
  getAll(): CampusFeature[];
  getById(id: string): CampusFeature | undefined;
  getByIds(ids: string[]): CampusFeature[];
  getByType(type: FeatureCategory): CampusFeature[];
  search(query: string): CampusFeature[];
  searchRemote?(query: string,signal?:AbortSignal): Promise<CampusFeature[]>;
  resolveGis(source: string, id: string, properties?: Record<string, unknown>): string | undefined;
}
