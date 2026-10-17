import {DORM_COMPOUND_PRESENTATION_ENABLED as DORM_COMPOUND_REVIEW_ENABLED} from '../three/CampusDetailReview';
import {dormitoryCompoundFor,dormitoryCompoundGeometry} from '../features/CampusDormitoryCompounds';
import {planDisplayId,roofGroupFor,roofGroupGeometry} from './CampusPlanRoofGroups';
import {ACADEMIC_REFINEMENT_ENABLED} from '../three/CampusDetailReview';
import {academicRefinementFor,academicRefinementGeometry} from './CampusAcademicRefinement';
export const reviewedDisplayGroup=(id:string)=>(ACADEMIC_REFINEMENT_ENABLED?academicRefinementFor(id):undefined)??(DORM_COMPOUND_REVIEW_ENABLED?dormitoryCompoundFor(id):undefined)??roofGroupFor(id);
export const reviewedDisplayId=(id:string)=>reviewedDisplayGroup(id)?.root??planDisplayId(id);
export const reviewedDisplayGeometry=(id:string)=>(ACADEMIC_REFINEMENT_ENABLED?academicRefinementGeometry(id):undefined)??(DORM_COMPOUND_REVIEW_ENABLED?dormitoryCompoundGeometry(id):undefined)??roofGroupGeometry(id);
