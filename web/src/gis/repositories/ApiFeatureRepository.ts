import type { CampusFeature, FeatureCategory } from '../../types/CampusFeature';
import type { FeatureRepository } from './FeatureRepository';
import { fetchBusinessFeatures, searchFeatures } from '../../api/featureApi';
import { teachingPresentation } from '../features/TeachingBuildingPresentation';
import { residentialPresentation } from '../features/CampusResidentialPlan';
import { academicPresentation } from '../features/CampusAcademicPlan';
import { campusIdentityPresentation } from '../features/CampusBuildingIdentity';
import { rankFeatureSearch } from './FeatureSearchRanking';

/** Business metadata is API-authoritative; static MapLibre layer GeoJSON remains a rendering asset. */
export class ApiFeatureRepository implements FeatureRepository {
  private byId=new Map<string,CampusFeature>();
  private gisToBusiness=new Map<string,string>();
  async load(signal?:AbortSignal) {
    const records=await fetchBusinessFeatures(signal);
    const byId=new Map<string,CampusFeature>(),gis=new Map<string,string>();
    for(const record of records){
      const feature=campusIdentityPresentation(academicPresentation(residentialPresentation(teachingPresentation(record))));
      if(byId.has(feature.id))throw Error('API returned duplicate feature ID: '+feature.id);
      byId.set(feature.id,feature);
      for(const binding of feature.gisBindings??[])gis.set(`${binding.source}:${binding.id}`,feature.id);
    }
    if(!byId.has('library')||!byId.has('south-gate'))throw Error('API is missing required campus features');
    this.byId=byId;this.gisToBusiness=gis;
  }
  getAll(){return [...this.byId.values()];}
  getById(id:string){return this.byId.get(id);}
  getByIds(ids:string[]){return ids.flatMap(id=>{const f=this.byId.get(id);return f?[f]:[];});}
  getByType(type:FeatureCategory){return this.getAll().filter(f=>f.category===type);}
  resolveGis(source:string,id:string,properties?:Record<string,unknown>){
    return this.gisToBusiness.get(`${source}:${id}`) ??
      (typeof properties?.featureId==='string'&&this.byId.has(properties.featureId)?properties.featureId:undefined) ??
      (typeof properties?.parentId==='string'&&this.byId.has(properties.parentId)?properties.parentId:undefined);
  }
  search(query:string){
    return rankFeatureSearch(this.getAll(),query);
  }
  async searchRemote(query:string,signal?:AbortSignal){
    if(!query.trim())return [];
    // Backend's legacy generic names may not know the plan aliases. Preserve API
    // authority and errors while merging already loaded presentation-name matches.
    const remote=(await searchFeatures(query.trim(),signal)).map(record=>campusIdentityPresentation(academicPresentation(residentialPresentation(teachingPresentation(record)))));
    const merged=new Map(this.search(query).map(feature=>[feature.id,feature]));
    for(const feature of remote)if(!merged.has(feature.id))merged.set(feature.id,feature);
    return rankFeatureSearch([...merged.values()],query);
  }
}
