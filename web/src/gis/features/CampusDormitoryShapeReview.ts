import type {Polygon} from 'geojson';
import {residentialRasterToLocal} from './CampusResidentialPlan';

/** Native campus_georef.tif pixels, NOT pixels from the differently sized JPG.
 * White roof envelopes only. No north/south ownership union, inferred passages,
 * new floors, field measurements, or perspective-to-GIS placement.
 */
export const DORMITORY_SHAPE_CORRECTIONS=[
  {id:'buildings:c09b0ffc76cdc23213cd',name:'梅园1号楼北楼',
    reason:'East short return was traced too far west; keep the west narrow inter-building passage outside this body.',
    pixels:[[3609,3751],[3785,3751],[3785,3770],[3793,3770],[3793,3833],[3755,3833],[3755,3802],[3785,3802],[3785,3794],[3609,3794]],
    includedCheckpoints:[[3770,3818]],excludedCheckpoints:[[3727,3818],[3630,3833]]},
  {id:'buildings:b1c906243f6aa6676326',name:'梅园4号楼南楼',
    reason:'Restore the white west short return, leave the north body and courtyard independently selectable.',
    pixels:[[3855,4144],[3890,4144],[3890,4174],[3863,4174],[3863,4186],[4034,4186],[4034,4228],[3862,4228],[3862,4211],[3855,4211]],
    includedCheckpoints:[[3870,4160]],excludedCheckpoints:[[3920,4160],[3865,4120]]},
].map(row=>{
  const ring=row.pixels.map(p=>residentialRasterToLocal([p[0]!-700,p[1]!-3600]));
  return {...row,geometry:{type:'Polygon',coordinates:[[...ring,[...ring[0]!]]]} as Polygon};
});
export const dormitoryShapeCorrection=(id:string)=>DORMITORY_SHAPE_CORRECTIONS.find(r=>r.id===id);
