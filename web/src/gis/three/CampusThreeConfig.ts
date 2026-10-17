import { coordinates } from '../coordinate/CampusCoordinateService';
import {DETAIL_REVIEW_ENABLED,DETAIL_RELEASE_ENABLED,DETAIL_REVIEW_ASSET,SHAPE_RELEASE_ENABLED,SHAPE_RELEASE_ASSET,ACADEMIC_REFINEMENT_ENABLED,NEXT_ACADEMIC_REFINEMENT_ENABLED} from './CampusDetailReview';
export const MODEL_URL = '/models/campus_refined_v005.glb';
export const MODEL_HASH = '7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65';
export const ACTIVE_MODEL_URL=DETAIL_REVIEW_ENABLED?DETAIL_REVIEW_ASSET.url:SHAPE_RELEASE_ENABLED?SHAPE_RELEASE_ASSET.url:DETAIL_RELEASE_ENABLED?'/models/campus_detail_release_v004.glb':MODEL_URL;
export const ACTIVE_MODEL_HASH=DETAIL_REVIEW_ENABLED?DETAIL_REVIEW_ASSET.hash:SHAPE_RELEASE_ENABLED?SHAPE_RELEASE_ASSET.sha256:DETAIL_RELEASE_ENABLED?DETAIL_REVIEW_ASSET.hash:MODEL_HASH;
export const MODEL_DISPLAY_LABEL=DETAIL_REVIEW_ENABLED?DETAIL_REVIEW_ASSET.label:NEXT_ACADEMIC_REFINEMENT_ENABLED?'学院区楼体修复 v006（尺寸估算）':ACADEMIC_REFINEMENT_ENABLED?'学院区连接部修复 v005（尺寸估算）':SHAPE_RELEASE_ENABLED?'全校楼体校核 v004（高度估算）':DETAIL_RELEASE_ENABLED?'楼层细化 v004（高度估算）':'v005';
export const CAMPUS_3D_ID = 'campus-3d';
export const CAMPUS_3D_MIN_ZOOM = 13.5;
export const CAMPUS_3D_VIEW = { lng: coordinates.localToWgs84([980,1100])[0], lat: coordinates.localToWgs84([980,1100])[1], zoom:14.5, pitch:45, bearing:0 };
export const MODEL_POINTS = [
  {id:'south-gate',node:'SOUTH_GATE_REFINED_ROOT',local:[981.0432739257812,58.78471755981445]},
  {id:'fusion-sculpture',node:'FUS_Root',local:[992.5923964337298,362.7571699554929]},
  {id:'library',node:'LIBRARY_REFINED_ROOT',local:[989.30029296875,556.8445434570312]},
  {id:'auditorium',node:'AUDITORIUM_REFINED_ROOT',local:[981.0433,1212]},
  {id:'stadium-east-01',node:'ST_EAST_01_Root',local:[1752.896,904.499]},
  {id:'stadium-west-02',node:'ST_WEST_02_Root',local:[139.800,1024.177]},
] as const;
export interface CampusThreeState {
  status:'idle'|'loading'|'ready'|'error'; visible:boolean; zoomSuppressed:boolean;
  error?:string; loadMs:number; firstRenderMs:number|null; fps:number|null;
  nodes:number; groundMaterials:number; alignment:unknown[]; environment:Record<string,unknown>;
}
export const initialThreeState = ():CampusThreeState => ({status:'idle',visible:false,zoomSuppressed:false,loadMs:0,firstRenderMs:null,fps:null,nodes:0,groundMaterials:0,alignment:[],environment:{}});
