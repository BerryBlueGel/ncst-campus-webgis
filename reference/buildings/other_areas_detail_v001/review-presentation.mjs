/** Same conservative display rule as CampusModelPresentation.ts; never edits geometry. */
export function hideDiagnosticContours(root){
  let hidden=0;
  root.traverse(object=>{
    if(!object.isLine)return;
    for(let node=object;node;node=node.parent){
      if(/^TPX_Contours(?:_|$)/.test(node.name)){
        object.visible=false;hidden++;break;
      }
    }
  });
  return hidden;
}

export function reviewLineCounts(root){
  const counts={lines:0,contourLines:0,hiddenContourLines:0,visibleContourLines:0,roadLines:0,visibleRoadLines:0};
  root.traverse(object=>{
    if(!object.isLine)return;
    counts.lines++;let contour=false,road=false,visible=true;
    for(let node=object;node;node=node.parent){
      contour ||= /^TPX_Contours(?:_|$)/.test(node.name);
      road ||= /^TPX_Roads(?:_|$)/.test(node.name);
      visible &&= node.visible!==false;
    }
    if(contour){counts.contourLines++;counts[visible?'visibleContourLines':'hiddenContourLines']++;}
    if(road){counts.roadLines++;if(visible)counts.visibleRoadLines++;}
  });
  return counts;
}
