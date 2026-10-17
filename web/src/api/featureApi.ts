import type {CampusFeature} from '../types/CampusFeature';
import {httpClient} from './httpClient';
export async function fetchBusinessFeatures(signal?:AbortSignal){
  const {data}=await httpClient.get<{features:CampusFeature[]}>('/features',{params:{businessOnly:true,limit:500},signal});
  if(!Array.isArray(data.features))throw Error('API features response is invalid');
  return data.features;
}
export async function searchFeatures(q:string,signal?:AbortSignal){
  const {data}=await httpClient.get<CampusFeature[]>('/search',{params:{q,limit:40},signal});
  return data;
}
export async function fetchFeature(id:string){
  const {data}=await httpClient.get<CampusFeature>(`/features/${encodeURIComponent(id)}`);
  return data;
}
