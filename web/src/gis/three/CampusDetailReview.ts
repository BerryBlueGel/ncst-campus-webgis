import manifest from './CampusDetailReviewManifest.json';
import shapeManifest from './CampusShapeReviewManifest.json';
import dormManifest from './CampusDormitoryShapeManifest.json';
import compoundManifest from './CampusDormitoryCompoundManifest.json';
import releaseManifest from './CampusShapeReleaseManifest.json';
import academicManifest from './CampusAcademicRefinementManifest.json';
import nextAcademicManifest from './CampusAcademicRefinementV006Manifest.json';
type ReviewEnv={DEV?:boolean;VITE_CAMPUS_DETAIL_REVIEW?:string;VITE_CAMPUS_DETAIL_RELEASE?:string;VITE_CAMPUS_SHAPE_REVIEW?:string;VITE_CAMPUS_SHAPE_RELEASE?:string};
/** Production publication is explicit; a review flag alone still cannot publish. */
export function shapeReleaseEnabled(env:ReviewEnv|undefined){return ['4','5','6'].includes(env?.VITE_CAMPUS_SHAPE_RELEASE??'');}
export const NEXT_ACADEMIC_REFINEMENT_ENABLED=import.meta.env?.VITE_CAMPUS_SHAPE_RELEASE==='6';
export const ACADEMIC_REFINEMENT_ENABLED=['5','6'].includes(import.meta.env?.VITE_CAMPUS_SHAPE_RELEASE??'');
export const ACADEMIC_DISPLAY_MANIFEST=NEXT_ACADEMIC_REFINEMENT_ENABLED?nextAcademicManifest:academicManifest;
export const SHAPE_RELEASE_ENABLED=shapeReleaseEnabled(import.meta.env);
/** Fail closed: production builds cannot select a local candidate, even if the flag is set. */
export function detailReviewEnabled(env:ReviewEnv|undefined){return env?.DEV===true&&env.VITE_CAMPUS_DETAIL_REVIEW==='1';}
export function shapeReviewEnabled(env:ReviewEnv|undefined){return env?.DEV===true&&['1','2','3'].includes(env.VITE_CAMPUS_SHAPE_REVIEW??'');}
export function dormShapeReviewEnabled(env:ReviewEnv|undefined){return env?.DEV===true&&env.VITE_CAMPUS_SHAPE_REVIEW==='2';}
export function dormCompoundReviewEnabled(env:ReviewEnv|undefined){return env?.DEV===true&&env.VITE_CAMPUS_SHAPE_REVIEW==='3';}
export const DORM_COMPOUND_REVIEW_ENABLED=dormCompoundReviewEnabled(import.meta.env);
export const DORM_COMPOUND_PRESENTATION_ENABLED=DORM_COMPOUND_REVIEW_ENABLED||SHAPE_RELEASE_ENABLED;
export const DORM_SHAPE_REVIEW_ENABLED=dormShapeReviewEnabled(import.meta.env);
export const SHAPE_REVIEW_ENABLED=shapeReviewEnabled(import.meta.env);
export const DETAIL_REVIEW_ENABLED=detailReviewEnabled(import.meta.env)||SHAPE_REVIEW_ENABLED;
/** Explicit deployment switch, separate from the dev-only review flag. Formal v005 stays available. */
export function detailReleaseEnabled(env:ReviewEnv|undefined){return env?.VITE_CAMPUS_DETAIL_RELEASE==='1';}
export const DETAIL_RELEASE_ENABLED=detailReleaseEnabled(import.meta.env);
export const DETAIL_PRESENTATION_ENABLED=DETAIL_REVIEW_ENABLED||DETAIL_RELEASE_ENABLED||SHAPE_RELEASE_ENABLED;
export const SHAPE_RELEASE_ASSET=ACADEMIC_REFINEMENT_ENABLED?ACADEMIC_DISPLAY_MANIFEST:releaseManifest;
export const DETAIL_REVIEW_ASSET={url:manifest.url,hash:DORM_COMPOUND_REVIEW_ENABLED?compoundManifest.sha256:DORM_SHAPE_REVIEW_ENABLED?dormManifest.sha256:SHAPE_REVIEW_ENABLED?shapeManifest.sha256:manifest.sha256,label:DORM_COMPOUND_REVIEW_ENABLED?'宿舍整体校核 v003（连接部高度估算）':DORM_SHAPE_REVIEW_ENABLED?'宿舍区形状校核 v002（高度沿用估算）':SHAPE_REVIEW_ENABLED?'楼体形状校核 v001（高度沿用估算）':'楼层细化候选 v004（高度估算）'} as const;
export function reviewStoreys(id:string|undefined){
  if(!DETAIL_PRESENTATION_ENABLED||!id)return undefined;
  return (manifest.heightEstimates as Record<string,{storeys:number;storeyHeightMeters:number;bodyHeightMeters:number;heightAboveRootMeters:number}>)[id];
}
export function isEmbeddedDetailReview(scene:{userData:Record<string,unknown>}){
  return scene.userData.campus_detail_version==='release_v004';
}
