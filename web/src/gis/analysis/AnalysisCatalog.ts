import type { FeatureCollection } from 'geojson';
import type { FeatureRepository } from '../repositories/FeatureRepository';
import type { AnalysisTarget } from './AnalysisTypes';
import { polygonTarget } from './FeatureGeometryAdapter';

export class AnalysisCatalog {
  private targets:AnalysisTarget[]=[];
  constructor(private repository:FeatureRepository){}
  async load(){
    const entries=[['boundary','campus_boundary'],['green','green_areas']] as const;
    const data=await Promise.all(entries.map(async ([,filename])=>{
      const response=await fetch(`/data/${filename}.geojson`);
      if(!response.ok)throw Error(`分析图层加载失败：${filename}`);
      return response.json() as Promise<FeatureCollection>;
    }));
    this.targets=this.repository.getAll().flatMap(feature=>{const target=polygonTarget(feature);return target?[target]:[];});
    entries.forEach(([category],i)=>data[i].features.forEach((feature,index)=>{
      if(feature.geometry?.type!=='Polygon'&&feature.geometry?.type!=='MultiPolygon')return;
      const id=String(feature.id??index),name=category==='boundary'?'校园边界':String(feature.properties?.name??`绿地 ${index+1}`);
      this.targets.push({id:category==='boundary'?'boundary:campus':`green:${id}`,name,category,
        feature:feature as AnalysisTarget['feature']});
    }));
  }
  getAll(){return this.targets;}
  get(id:string){return this.targets.find(target=>target.id===id);}
  getGreen(){return this.targets.filter(target=>target.category==='green');}
}
