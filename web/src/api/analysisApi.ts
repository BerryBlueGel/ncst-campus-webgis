import type {Geometry} from 'geojson';
import {httpClient} from './httpClient';
export async function backendDistance(geometry:Geometry){const {data}=await httpClient.post<{distanceMeters:number}>('/analysis/distance',{geometry});return data;}
export async function backendArea(geometry:Geometry){const {data}=await httpClient.post<{areaSquareMeters:number}>('/analysis/area',{geometry});return data;}
export async function backendBuffer(geometry:Geometry,radiusMeters:number){const {data}=await httpClient.post<{geometry:Geometry;radiusMeters:number}>('/analysis/buffer',{geometry,radiusMeters});return data;}
export async function backendNearest(longitude:number,latitude:number,types?:string[]){const {data}=await httpClient.post<{feature:{id:string;name:string};distanceMeters:number}>('/analysis/nearest',{longitude,latitude,types});return data;}
export async function backendIntersection(geometry:Geometry,targetFeatureId:string){const {data}=await httpClient.post<{intersects:boolean;geometry:Geometry|null;areaSquareMeters:number}>('/analysis/intersection',{geometry,targetFeatureId});return data;}
export async function backendNearby(longitude:number,latitude:number,radiusMeters:number,types?:string[]){const {data}=await httpClient.post('/analysis/nearby',{longitude,latitude,radiusMeters,types});return data;}
export async function backendWithin(longitude:number,latitude:number,featureId:string){
  const {data}=await httpClient.post<{within:boolean;boundaryCountsAsWithin:boolean}>('/analysis/within',{longitude,latitude,featureId});return data;
}
export async function backendBBox(west:number,south:number,east:number,north:number){
  const {data}=await httpClient.get<{features:Array<{id:string}>}>('/features',{params:{bbox:[west,south,east,north].join(','),businessOnly:true,limit:500}});
  return data;
}
