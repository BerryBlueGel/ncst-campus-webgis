export function isClickGesture(start:{x:number;y:number}|null,end:{x:number;y:number},threshold=5):boolean {
  return !!start&&Math.hypot(end.x-start.x,end.y-start.y)<=threshold;
}
