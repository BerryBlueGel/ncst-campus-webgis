import type { Object3D } from 'three';

/** New shape candidates retain old geometry for rollback/reference, not display. */
export function hideShapeReviewReferences(root:Object3D){
  root.traverse(node=>{if(node.userData.shape_review_reference_only===true)node.visible=false;});
}

/** Hide ONLY diagnostic contour lines in runtime views. Keep the v005 asset,
 * hierarchy, mesh geometry and GIS data intact; do not hide roads or building lines.
 */
export function hideDiagnosticContours(root:Object3D):number {
  let count=0;
  root.traverse(object=>{
    if(!(object as Object3D & {isLine?:boolean}).isLine)return;
    for(let node:Object3D|null=object;node;node=node.parent){
      if(/^TPX_Contours(?:_|$)/.test(node.name)){
        object.visible=false;count++;break;
      }
    }
  });
  return count;
}

/** Resolve full hierarchy paths: TPX mesh names are duplicated across Areas. */
export function modelAtPath(root:Object3D,path:string):Object3D|undefined {
  let node:Object3D|undefined=root;
  for(const name of path.split('/'))node=node?.children.find(child=>child.name===name);
  return node;
}
