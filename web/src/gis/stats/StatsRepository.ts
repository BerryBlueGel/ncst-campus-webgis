import { fetchStats } from '../../api/statsApi';
import { StaticCampusDataRepository } from '../repositories/CampusDataRepository';
import { STAT_LAYERS, calculateStaticStats, collectionArea, validateStats, type DashboardStats } from './CampusStats';
export async function loadDashboardStats(source: 'api' | 'static', signal?: AbortSignal): Promise<DashboardStats> {
  const repo = new StaticCampusDataRepository();
  if (source === 'api') {
    const [overview, boundary] = await Promise.all([fetchStats(signal), repo.getLayer('/data/campus_boundary.geojson', signal)]);
    return { ...validateStats(overview), campusAreaSquareMeters: collectionArea(boundary.data), source, loadedAt: new Date().toISOString() };
  }
  const collections = Object.fromEntries(await Promise.all(STAT_LAYERS.map(async ({ key }) => {
    const result = await repo.getLayer(`/data/${key}.geojson`, signal); return [key, result.data] as const;
  })));
  return { ...calculateStaticStats(collections), campusAreaSquareMeters: collectionArea(collections.campus_boundary!), source, loadedAt: new Date().toISOString() };
}
