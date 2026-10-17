import type { CampusFeature } from '../../types/CampusFeature';
import { ROUGH_HEIGHT_STATUS, TEACHING_NAME_SOURCE } from '../features/TeachingBuildingPresentation';

export function displayProperties(feature:CampusFeature,detailReview=false):{label:string,value:string}[]{
  const p=feature.properties,rows:{label:string,value:string}[]=[];
  const number=(key:string,label:string,suffix:string,digits=0)=>{
    const n=p[key];if(typeof n==='number'&&Number.isFinite(n))rows.push({label,value:`${n.toFixed(digits)} ${suffix}`});
  };
  if(feature.category==='building'){
    const rough=p.heightStatus===ROUGH_HEIGHT_STATUS;
    // No quality metadata means no claim of a surveyed height, even outside the
    // teaching group. An explicit SURVEYED/API status must remain authoritative.
    const unverified=p.heightStatus==null||p.heightStatus==='HEIGHT_UNVERIFIED';
    number('height',detailReview?'原始 GIS 高度（不用于候选模型）':rough?'源粗模高度（非实测）':unverified?'高度（来源未核实）':'高度','m',1);
    number('area',rough?'源轮廓面积':'占地面积','m²');
    if(p.nameSource===TEACHING_NAME_SOURCE)rows.push({label:'楼名依据',value:'用户提供的校园总图（非现行官方目录）'});
    if(typeof p.sourceLabel==='string')rows.push({label:'原始编号',value:p.sourceLabel});
  }else if(feature.category==='stadium'){
    number('orientation','跑道朝向','°',2);
    const length=p.trackLength,width=p.trackWidth;
    if(typeof length==='number'&&typeof width==='number')rows.push({label:'跑道包络',value:`${length.toFixed(1)} × ${width.toFixed(1)} m（近似）`});
    const stand=p.standStatus;
    if(stand&&typeof stand==='object'){
      const status=stand as Record<string,unknown>;
      rows.push({label:'看台',value:status.present===true?'已确认':status.present==='uncertain'?'待核实':'未确认'});
    }
  }
  if(feature.refined)rows.push({label:'三维模型',value:'已精修'});
  return rows;
}
export function featureCamera(feature:CampusFeature,three:boolean){
  const zoom=feature.category==='stadium'?17:feature.category==='building'?17.5:18;
  return {lng:feature.centroid[0],lat:feature.centroid[1],zoom,pitch:three?50:0,bearing:0};
}
