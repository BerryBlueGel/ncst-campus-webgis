import type { ExpressionSpecification } from 'maplibre-gl';
import { planDispositionFor,CAMPUS_PLAN_DISPOSITIONS,EARLIER_OWNERSHIP_GAPS,suppressedInPlanPreview } from '../features/CampusPlanDispositions';
import {roofGroupFor} from './CampusPlanRoofGroups';

export const SOURCE_FRAGMENT_LAYER='buildings-source-fragments';
export const SOURCE_FRAGMENT_ROLE='UNVERIFIED_SOURCE_FRAGMENT';
export const isUnverifiedSourceFragment=(id:string)=>planDispositionFor(id)?.status==='OWNER_OR_ROOF_SCOPE_UNCERTAIN';
// Source ownership remains uncertain even when the schematic roof is clear.
export const UNRESOLVED_DISPLAY_FRAGMENT_IDS=[...CAMPUS_PLAN_DISPOSITIONS,...EARLIER_OWNERSHIP_GAPS]
  .filter(row=>isUnverifiedSourceFragment(row.id)&&!roofGroupFor(row.id)&&!suppressedInPlanPreview(row.id)).map(row=>row.id);

/** Review geometry is never a new building or an inferred piece of a neighbor. */
export function sourceFragmentOpacity(review:boolean,opacity:number):ExpressionSpecification {
  return ['case',['boolean',['feature-state','selected'],false],opacity,
    ['boolean',['feature-state','hover'],false],review?opacity:0,review?opacity*0.8:0];
}
export const sourceFragmentPickEnabled=(review:boolean,selected:string|null)=>review||(selected!==null&&isUnverifiedSourceFragment(selected));
