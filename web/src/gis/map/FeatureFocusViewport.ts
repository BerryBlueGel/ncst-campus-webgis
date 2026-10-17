export interface FocusRect {left:number;right:number;top:number;bottom:number}
export interface FocusPadding {top:number;bottom:number;left:number;right:number}

/** Camera-only screen space: neither coordinates nor analytical bounds change. */
export function featureFocusViewport(map:FocusRect,panel:FocusRect|null,narrow:boolean){
  const width=Math.max(1,map.right-map.left),height=Math.max(1,map.bottom-map.top);
  const overlapWidth=panel?Math.max(0,Math.min(map.right,panel.right)-Math.max(map.left,panel.left)):0;
  // Desktop side panels are outside the map. A hidden sheet has a zero rect.
  const bottomOverlap=panel&&overlapWidth>width*0.75&&panel.bottom>=map.bottom-2&&panel.top<map.bottom
    ?Math.max(0,map.bottom-Math.max(map.top,panel.top)):0;
  const side=Math.min(narrow?20:45,width*0.2);
  const top=Math.min(narrow?20:160,height*0.3);
  // Never pass impossible padding to MapLibre, even during a short resize.
  const bottom=Math.min((narrow?20:45)+bottomOverlap,Math.max(0,height-top-Math.min(80,height*0.4)));
  const padding:FocusPadding={top,bottom,left:side,right:side};
  const offset:[number,number]=[0,(top-bottom)/2];
  return {padding,offset,occluded:bottomOverlap>0};
}
