import type { CampusFeature } from '../../types/CampusFeature';

/** Stable-ID presentation crosswalk, checked against the user-supplied campus plan.
 * This is NOT an as-built survey. Do not union nearby parts, change source geometry,
 * promote default 6m to measured height, or assign an unverified annex to a building.
 */
export interface TeachingBuildingReference {
  id: string;
  name: string;
  block: string;
  sourceLabel: string;
  modelPath: string;
  use: string;
  nearbyParts?: readonly string[];
  planConnection?: string;
}

export const TEACHING_BUILDINGS: readonly TeachingBuildingReference[] = [
  {id:'buildings:119a94f3e7e585a533e1',name:'求真楼',block:'E',sourceLabel:'建筑 064',use:'公共教学楼',modelPath:'Area_02/TPX_Buildings_1/TPX_Buildings_8_1'},
  {id:'buildings:2ac3ae0f3c8f8ebc9052',name:'知行楼',block:'L',sourceLabel:'建筑 070',use:'公共实验楼',modelPath:'Area_04/TPX_Buildings_3/TPX_Buildings_35_1',nearbyParts:['buildings:c00db434039442f40ee9','buildings:6a708aca8b5af56df102']},
  {id:'buildings:2f2c84cadd1be3b196b5',name:'笃学楼',block:'C',sourceLabel:'建筑 053',use:'公共教学楼',modelPath:'Area_01/TPX_Buildings/TPX_Buildings_65',nearbyParts:['buildings:eea2b80f62a4d82b2c84'],planConnection:'敏思楼'},
  {id:'buildings:801a933bca94e1a3e513',name:'敬业楼',block:'D',sourceLabel:'建筑 038',use:'公共教学楼',modelPath:'Area_03/TPX_Buildings_2/TPX_Buildings_48',planConnection:'崇德楼'},
  {id:'buildings:3c0be6adc754661c3cf1',name:'敏思楼',block:'A',sourceLabel:'建筑 042',use:'公共教学楼',modelPath:'Area_01/TPX_Buildings/TPX_Buildings_54',planConnection:'笃学楼'},
  {id:'buildings:fc63707b67a778c1dd5e',name:'崇德楼',block:'B',sourceLabel:'建筑 039',use:'公共教学楼',modelPath:'Area_03/TPX_Buildings_2/TPX_Buildings_49_1',planConnection:'敬业楼'},
  {id:'buildings:7b71dc7137f61b013149',name:'知新楼',block:'K',sourceLabel:'建筑 041',use:'教学科研建筑',modelPath:'Area_01/TPX_Buildings/TPX_Buildings_53'},
  {id:'buildings:9d12731a8fc687f20c37',name:'致远楼',block:'F',sourceLabel:'建筑 040',use:'教学科研建筑',modelPath:'Area_03/TPX_Buildings_2/TPX_Buildings_50'},
];

const PARTS = [
  {id:'buildings:c00db434039442f40ee9',sourceLabel:'建筑 150',mainId:'buildings:2ac3ae0f3c8f8ebc9052',modelPath:'Area_04/TPX_Buildings_3/TPX_Buildings_33_2'},
  {id:'buildings:6a708aca8b5af56df102',sourceLabel:'建筑 151',mainId:'buildings:2ac3ae0f3c8f8ebc9052',modelPath:'Area_04/TPX_Buildings_3/TPX_Buildings_34_1'},
  {id:'buildings:eea2b80f62a4d82b2c84',sourceLabel:'建筑 054',mainId:'buildings:2f2c84cadd1be3b196b5',modelPath:'Area_01/TPX_Buildings/TPX_Buildings_66'},
] as const;

export const TEACHING_MODEL_BINDINGS = [...TEACHING_BUILDINGS,...PARTS].map(({id,modelPath})=>({id,path:modelPath}));
export const TEACHING_NAME_SOURCE = 'USER_SUPPLIED_SCHEMATIC_PLAN';
export const ROUGH_HEIGHT_STATUS = 'SOURCE_ROUGH_MODEL_NOT_SURVEYED';

/** Decorate copies in BOTH static/API modes; geometry, bounds, IDs and bindings remain exact. */
export function teachingPresentation(feature:CampusFeature):CampusFeature {
  if(feature.category!=='building')return feature;
  const ref=TEACHING_BUILDINGS.find(r=>r.id===feature.id);
  const part=PARTS.find(r=>r.id===feature.id);
  if(!ref&&!part)return feature;
  const main=ref??TEACHING_BUILDINGS.find(r=>r.id===part!.mainId)!;
  const notes=ref
    ? `楼名及座号依据用户提供的校园总图；权威轮廓仍为原始 GIS 粗模，展示工作版可单独切换，尚未完成实建校核。${ref.planConnection?`总图绘有与${ref.planConnection}的连接部分，连廊轮廓与实建状态待核实。`:''}`
    : `位于${main.name}院落附近的独立源分块；是否属于主楼、连廊或其他设施尚未核实，未合并为同一建筑。`;
  return {...feature,
    name:ref?`${ref.name}（${ref.block} 座）`:`${part!.sourceLabel}（待核实分块）`,
    type:ref?.use??feature.type,
    description:notes,
    aliases:[...new Set([...feature.aliases,ref?.sourceLabel??part!.sourceLabel,
      ...(ref?[ref.name,`${ref.block}座`,`${ref.block} 座`,`${ref.name}${ref.block}座`]:[])])],
    keywords:[...new Set([...feature.keywords,'中心教学区',...(ref?[ref.use]:['待核实分块'])])],
    modelBinding:ref?.modelPath??part!.modelPath,
    properties:{...feature.properties,
      heightStatus:feature.properties.heightStatus??(feature.properties.height===6?ROUGH_HEIGHT_STATUS:'HEIGHT_UNVERIFIED'),
      nameSource:ref?TEACHING_NAME_SOURCE:'SOURCE_FRAGMENT_UNVERIFIED',
      sourceLabel:ref?.sourceLabel??part!.sourceLabel,
      teachingMainId:main.id,
      nearbyPartIds:ref?[...(ref.nearbyParts??[])]:[main.id],
      geometryStatus:'SOURCE_FOOTPRINT_UNCHANGED',
    },
  };
}

/** Same courtyard is an inspection relationship, never a physical/business union. */
export function teachingRelatedIds(id:string):readonly string[] {
  const main=TEACHING_BUILDINGS.find(r=>r.id===id);
  if(main)return main.nearbyParts??[];
  const part=PARTS.find(r=>r.id===id);
  return part?[part.mainId]:[];
}
