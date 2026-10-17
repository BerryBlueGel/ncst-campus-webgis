import type { Feature, Geometry, Polygon, MultiPolygon } from 'geojson';
import type { CampusFeature } from '../../types/CampusFeature';

export type LngLat = [number,number];
export type AnalysisTool = 'coordinate'|'distance'|'area'|'buffer'|'nearest'|'bbox'|'pip'|'intersection';
export type AnalysisStatus = 'idle'|'drawing'|'ready'|'error';
export type NearestCategory = 'all'|'building'|'stadium'|'landmark'|'poi';
export type PolygonCategory = 'boundary'|'building'|'stadium'|'green';
export interface AnalysisTarget {
  id:string;name:string;category:PolygonCategory;
  feature:Feature<Polygon|MultiPolygon>;
  businessId?:string;
}
export interface AnalysisMeasurement {
  kind:'coordinate'|'distance'|'area'|'buffer'|'nearest'|'bbox'|'pip'|'intersection';
  primary:string;
  details:Record<string,string|number|boolean>;
  elapsedMs:number;
  raw?:Record<string,unknown>;
}
export interface AnalysisState {
  activeTool:AnalysisTool|null;
  status:AnalysisStatus;
  inputGeometry:Feature<Geometry>|null;
  resultGeometry:Feature<Geometry>|null;
  resultFeatures:CampusFeature[];
  measurement:AnalysisMeasurement|null;
  points:LngLat[];
  error:string;
  hint:string;
  nearestCategory:NearestCategory;
  targetId:string;
  sourceId:string;
  bufferRadius:number;
}
export const INITIAL_ANALYSIS_STATE:AnalysisState={
  activeTool:null,status:'idle',inputGeometry:null,resultGeometry:null,resultFeatures:[],measurement:null,
  points:[],error:'',hint:'选择工具开始分析',nearestCategory:'all',targetId:'boundary:campus',sourceId:'',bufferRadius:100,
};
