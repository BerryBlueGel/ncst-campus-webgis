export function readSelected(params:URLSearchParams,has:(id:string)=>boolean):string|null {
  const id=params.get('selected');return id&&has(id)?id:null;
}
export function selectedQuery(id:string|null):{selected:string|undefined}{return {selected:id??undefined};}
/** Selection-only navigation must carry the live mode, not the last settled URL. */
export function selectedQueryWithMode(id:string|null,threeRequested:boolean){
  return {...selectedQuery(id),mode:threeRequested?'3d':'2d'};
}
/** Unchanged mode in a selection/camera query is not a request to undo a local toggle. */
export function threeModeAfterRouteUpdate(mode:unknown,previousMode:unknown,current:boolean):boolean {
  return mode===previousMode?current:mode==='3d';
}
export function selectedQueryWhileLoading(id:string|null,ready:boolean,pending:unknown):{selected:string|undefined}{
  return ready?selectedQuery(id):{selected:id??(typeof pending==='string'?pending:undefined)};
}
