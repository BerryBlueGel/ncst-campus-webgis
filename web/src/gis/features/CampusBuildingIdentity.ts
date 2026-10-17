import type { CampusFeature } from '../../types/CampusFeature';
import { planDispositionFor } from './CampusPlanDispositions';
import { TEACHING_BUILDINGS,teachingRelatedIds } from './TeachingBuildingPresentation';
import {campusMapName} from './CampusMapNames';

export const PLAN_NAME_STATUS='USER_PLAN_LABEL_NOT_OFFICIAL_NAME_VERIFICATION';
const sourceName=(name:string)=>/^建筑\s*\d+(?:（待核实分块）)?$/.test(name);

/** Presentation only: no ID, geometry, category, height or ownership mutation. */
export function campusIdentityPresentation(feature:CampusFeature):CampusFeature {
  if(feature.category!=='building')return feature;
  const disposition=planDispositionFor(feature.id);
  const planLabel=typeof feature.properties.planLabel==='string'?feature.properties.planLabel:undefined;
  const teaching=TEACHING_BUILDINGS.find(r=>r.id===feature.id);
  const kind=disposition?.status==='OWNER_OR_ROOF_SCOPE_UNCERTAIN'?'UNCERTAIN_FRAGMENT'
    :disposition?.status==='RETAIN_ROOF_FRAGMENT'?'INDEPENDENT_ROOF_REFERENCE'
    :disposition?.suppressed?'PLAN_NON_BUILDING_REFERENCE':'BUILDING';
  const mainId=typeof feature.properties.teachingMainId==='string'?feature.properties.teachingMainId:undefined;
  const main=TEACHING_BUILDINGS.find(r=>r.id===mainId);
  const context=disposition?.note.split('：')[0];
  const originalLabel=feature.properties.sourceLabel??disposition?.sourceLabel??feature.name;
  const displayLabel=campusMapName(originalLabel,planLabel)??(kind==='UNCERTAIN_FRAGMENT'&&main?`${main.name}附近待核实分块`:context);
  const hasMapName=campusMapName(originalLabel)!==undefined;
  const previousFragmentLabel=context?`${context.replace(/，.*$/,'')}（${disposition?.sourceLabel}）`:undefined;
  const managedName=sourceName(feature.name)||(hasMapName&&feature.name===planLabel)||
    (hasMapName&&feature.properties.displayNameStatus===PLAN_NAME_STATUS&&
      (feature.name===previousFragmentLabel||feature.name===feature.properties.mapLabel));
  const name=managedName&&displayLabel
    ?kind==='BUILDING'||hasMapName?displayLabel:`${displayLabel.replace(/，.*$/,'')}（${disposition!.sourceLabel}）`
    :feature.name;
  const provenance=hasMapName||planLabel||teaching?'USER_SUPPLIED_SCHEMATIC_PLAN':disposition?'PLAN_CONTEXT_NOT_OWNERSHIP':undefined;
  if(!provenance)return feature;
  const originalName=feature.properties.sourceName??feature.name;
  return {...feature,name,
    aliases:[...new Set([...feature.aliases,feature.name,...[planLabel,displayLabel,originalName,originalLabel,disposition?.sourceLabel].filter((value):value is string=>typeof value==='string')])],
    properties:{...feature.properties,
      sourceLabel:originalLabel,
      identityKind:kind,displayNameSource:provenance,
      sourceName:originalName,
      displayNameStatus:PLAN_NAME_STATUS,
      ...(hasMapName?{mapLabel:displayLabel}:{}),
      ...(disposition?{fragmentStatus:disposition.status,fragmentNote:disposition.note}:{}),
    },
  };
}

/** Nearby alternatives for inspection, never inferred parent/whole-building IDs. */
export function nearbyIdentityIds(feature:CampusFeature,features:readonly CampusFeature[]):string[] {
  if(!['UNCERTAIN_FRAGMENT','INDEPENDENT_ROOF_REFERENCE'].includes(String(feature.properties.identityKind)))return [];
  const explicit=[...teachingRelatedIds(feature.id)];
  const distance=(other:CampusFeature)=>Math.hypot((other.centroid[0]-feature.centroid[0])*Math.cos(feature.centroid[1]*Math.PI/180)*111320,(other.centroid[1]-feature.centroid[1])*111320);
  const nearby=features.filter(f=>f.id!==feature.id&&f.category==='building'&&f.properties.identityKind==='BUILDING'&&f.properties.displayNameSource==='USER_SUPPLIED_SCHEMATIC_PLAN'&&distance(f)<150)
    .sort((a,b)=>distance(a)-distance(b)||a.id.localeCompare(b.id)).map(f=>f.id);
  return [...new Set([...explicit,...nearby])].slice(0,3);
}
