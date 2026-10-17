import { area, bbox, booleanPointInPolygon, pointOnFeature } from '@turf/turf';
import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from 'geojson';
import type { CampusFeature, FeatureCategory } from '../../types/CampusFeature';
import type { FeatureRepository } from './FeatureRepository';
import { teachingPresentation } from '../features/TeachingBuildingPresentation';
import { residentialPresentation } from '../features/CampusResidentialPlan';
import { academicPresentation } from '../features/CampusAcademicPlan';
import { campusIdentityPresentation } from '../features/CampusBuildingIdentity';
import { rankFeatureSearch } from './FeatureSearchRanking';

export interface FeatureSources {
  buildings: FeatureCollection;
  sports: FeatureCollection;
  landmarks: FeatureCollection;
  pois: FeatureCollection;
}
const modelRoots:Record<string,string> = {
  library:'LIBRARY_REFINED_ROOT', 'south-gate':'SOUTH_GATE_REFINED_ROOT',
  auditorium:'AUDITORIUM_REFINED_ROOT', 'fusion-sculpture':'FUS_Root',
  'stadium-east-01':'ST_EAST_01_Root','stadium-east-02':'ST_EAST_02_Root',
  'stadium-west-01':'ST_WEST_01_Root','stadium-west-02':'ST_WEST_02_Root',
};
const aliases:Record<string,string[]> = {
  library:['library','图书馆'], 'south-gate':['south gate','南门','学校南门'],
  auditorium:['auditorium','会堂','校会堂','大会堂'], 'fusion-sculpture':['融合','融合雕塑'],
  'stadium-east-01':['东区一号体育场','东一体育场','east stadium 01'],
  'stadium-east-02':['东区二号体育场','东二体育场','east stadium 02'],
  'stadium-west-01':['西区一号体育场','西一体育场','west stadium 01'],
  'stadium-west-02':['西区二号体育场','西二体育场','west stadium 02'],
};
function boundsOf(feature:Feature):[[number,number],[number,number]]|undefined {
  if(feature.geometry.type==='Point')return;
  const [west,south,east,north]=bbox(feature);
  return [[west,south],[east,north]];
}
function centerOf(feature:Feature):[number,number] {
  if(feature.geometry.type==='Point')return [...feature.geometry.coordinates] as [number,number];
  return pointOnFeature(feature).geometry.coordinates as [number,number];
}
function featureOf(id:string,name:string,type:string,category:FeatureCategory,source:Feature,
  properties:Record<string,unknown>,description:string,refined=false):CampusFeature {
  return {id,name,type,category,geometry:source.geometry,centroid:centerOf(source),bounds:boundsOf(source),
    description,properties,modelBinding:modelRoots[id],refined,aliases:aliases[id]??[],
    keywords:category==='stadium'?['体育场','操场','田径场']:category==='building'?['建筑']:['校园地标'],
    gisBindings:[]};
}
function addBinding(feature:CampusFeature,source:string,id:string){
  if(!feature.gisBindings.some(b=>b.source===source&&b.id===id))feature.gisBindings.push({source,id});
}
export class StaticFeatureRepository implements FeatureRepository {
  private byId=new Map<string,CampusFeature>();
  private gisToBusiness=new Map<string,string>();
  private loading?:Promise<void>;
  constructor(sources?:FeatureSources){if(sources)this.ingest(sources);}
  async load(signal?:AbortSignal){
    if(this.loading)return this.loading;
    this.loading=(async()=>{
      const names=['buildings','sports','landmarks','pois'] as const;
      const data=await Promise.all(names.map(async name=>{
        const response=await fetch(`/data/${name}.geojson`,{signal});
        if(!response.ok)throw Error(`要素数据加载失败：${name} HTTP ${response.status}`);
        const collection=await response.json() as FeatureCollection;
        if(collection.type!=='FeatureCollection'||!Array.isArray(collection.features))throw Error(`要素数据格式错误：${name}`);
        return collection;
      }));
      this.ingest(Object.fromEntries(names.map((name,i)=>[name,data[i]])) as unknown as FeatureSources);
    })();
    try {await this.loading;} catch(error){this.loading=undefined;throw error;}
  }
  ingest(sources:FeatureSources){
    const byId=new Map<string,CampusFeature>();
    const gisToBusiness=new Map<string,string>();
    for(const source of sources.buildings.features){
      const id=String(source.id),height=Number(source.properties?.height);
      if(byId.has(id))throw Error(`重复要素 ID: ${id}`);
      const index=byId.size+1;
      const props:Record<string,unknown>={area:Math.round(area(source))};
      if(Number.isFinite(height))props.height=height;
      if(typeof source.properties?.heightStatus==='string')props.heightStatus=source.properties.heightStatus;
      const item=campusIdentityPresentation(academicPresentation(residentialPresentation(teachingPresentation(featureOf(id,`建筑 ${String(index).padStart(3,'0')}`,'建筑','building',source,props,'校园建筑轮廓来自现有 GIS 数据。')))));
      addBinding(item,'campus-buildings',id);byId.set(id,item);gisToBusiness.set(`campus-buildings:${id}`,id);
    }
    for(const source of sources.sports.features){
      if(source.properties?.kind!=='track_envelope')continue;
      const id=String(source.properties?.parentId??source.id),props=source.properties??{};
      if(byId.has(id))throw Error(`重复要素 ID: ${id}`);
      const item=featureOf(id,String(props.name??id),'体育场','stadium',source,
        {orientation:props.orientation,trackLength:props.trackLength,trackWidth:props.trackWidth,standStatus:props.standStatus},
        '田径场位置及范围来自配准校园总图，尺寸为近似值。',true);
      byId.set(id,item);
    }
    for(const source of sources.landmarks.features){
      const id=String(source.id),name=String(source.properties?.name??id);
      if(byId.has(id))throw Error(`重复要素 ID: ${id}`);
      const type=id==='library'?'图书馆':id==='south-gate'?'校门':id==='auditorium'?'会堂':'雕塑';
      const item=featureOf(id,name,type,'landmark',source,{},'校园精修地标，位置依据现有 GIS 与模型校验数据。',true);
      addBinding(item,'campus-landmarks',id);byId.set(id,item);gisToBusiness.set(`campus-landmarks:${id}`,id);
    }
    for(const source of sources.sports.features){
      const id=String(source.properties?.parentId??source.id),item=byId.get(id);
      if(!item)continue;
      addBinding(item,'campus-sports',String(source.id));gisToBusiness.set(`campus-sports:${String(source.id)}`,id);
    }
    for(const source of sources.pois.features){
      const id=String(source.properties?.featureId??''),item=byId.get(id);
      if(!item)continue;
      addBinding(item,'campus-poi',String(source.id));gisToBusiness.set(`campus-poi:${String(source.id)}`,id);
    }
    // Phase 2 retained two library footprints and one auditorium footprint.
    for(const id of ['library','auditorium'] as const){
      const item=byId.get(id);if(!item)continue;
      const point:Feature<Point>={type:'Feature',properties:{},geometry:{type:'Point',coordinates:item.centroid}};
      for(const polygon of sources.buildings.features){
        if((polygon.geometry.type==='Polygon'||polygon.geometry.type==='MultiPolygon')&&
          booleanPointInPolygon(point,polygon as Feature<Polygon|MultiPolygon>)){
          addBinding(item,'campus-buildings',String(polygon.id));
          gisToBusiness.set(`campus-buildings:${String(polygon.id)}`,id);
          const bounds=boundsOf(polygon);
          if(bounds)item.bounds=item.bounds?[[Math.min(item.bounds[0][0],bounds[0][0]),Math.min(item.bounds[0][1],bounds[0][1])],
            [Math.max(item.bounds[1][0],bounds[1][0]),Math.max(item.bounds[1][1],bounds[1][1])]]:bounds;
        }
      }
    }
    this.byId=byId;this.gisToBusiness=gisToBusiness;
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
}
