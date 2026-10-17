export type QueryValue = string | string[] | null | undefined;
export type ImmersiveQuery = Record<string,QueryValue>;

export function isImmersiveView(query:ImmersiveQuery):boolean {
  return query.view==='immersive';
}
export function enterImmersiveQuery(query:ImmersiveQuery,selected:string|null):ImmersiveQuery {
  return {...query,view:'immersive',selected:selected??undefined};
}
export function exitImmersiveQuery(query:ImmersiveQuery):ImmersiveQuery {
  return {...query,view:undefined};
}
