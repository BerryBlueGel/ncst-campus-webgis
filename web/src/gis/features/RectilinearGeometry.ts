export type LocalPoint = [number,number];
const edgeAngle=(a:LocalPoint,b:LocalPoint)=>Math.atan2(b[1]-a[1],b[0]-a[0]);
/** Fourfold angular mean: a shared building frame, not forced GIS cardinal axes. */
export function sharedRectilinearAngle(rings:readonly LocalPoint[][],minimumEdge=15):number {
  let x=0,y=0;
  for(const ring of rings)for(let i=0;i<ring.length;i++){
    const a=ring[i]!,b=ring[(i+1)%ring.length]!,length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(length<minimumEdge)continue;
    const theta=edgeAngle(a,b);x+=length*Math.cos(theta*4);y+=length*Math.sin(theta*4);
  }
  if(Math.hypot(x,y)<1e-8)throw Error('No stable rectilinear direction');
  return Math.atan2(y,x)/4;
}
/** Least-squares equality constraints on vertices in the shared orthogonal frame.
 * No scale, envelope fitting, vertex deletion, business union or source mutation.
 * Only explicitly reviewed rectilinear traces may use this function.
 */
export function orthogonalizeRing(ring:readonly LocalPoint[],angle:number,maxDisplacement=3):LocalPoint[] {
  if(ring.length<4)throw Error('Insufficient ring vertices');
  const origin:LocalPoint=[ring.reduce((s,p)=>s+p[0],0)/ring.length,ring.reduce((s,p)=>s+p[1],0)/ring.length];
  const c=Math.cos(angle),s=Math.sin(angle);
  const rotated=ring.map(([x,y]):LocalPoint=>[c*(x-origin[0])+s*(y-origin[1]),-s*(x-origin[0])+c*(y-origin[1])]);
  const parents=[ring.map((_,i)=>i),ring.map((_,i)=>i)];
  const root=(axis:number,index:number):number=>{const p=parents[axis]!;while(p[index]!==index)index=p[index]!;return index;};
  for(let i=0;i<ring.length;i++){
    const j=(i+1)%ring.length,a=rotated[i]!,b=rotated[j]!,dx=b[0]-a[0],dy=b[1]-a[1];
    if(Math.hypot(dx,dy)<1e-8)throw Error('Zero length edge');
    const deviation=Math.atan2(Math.min(Math.abs(dx),Math.abs(dy)),Math.max(Math.abs(dx),Math.abs(dy)))*180/Math.PI;
    if(deviation>15)throw Error('Non-rectilinear edge must not be snapped');
    const axis=Math.abs(dx)<Math.abs(dy)?0:1;
    parents[axis]![root(axis,j)]=root(axis,i);
  }
  const sums=[new Map<number,{sum:number,count:number}>(),new Map<number,{sum:number,count:number}>()];
  for(const axis of [0,1])for(let i=0;i<ring.length;i++){
    const r=root(axis,i),entry=sums[axis]!.get(r)??{sum:0,count:0};
    entry.sum+=rotated[i]![axis]!;entry.count++;sums[axis]!.set(r,entry);
  }
  return rotated.map((_,i)=>{
    const values=[0,1].map(axis=>{const entry=sums[axis]!.get(root(axis,i))!;return entry.sum/entry.count;});
    const point:LocalPoint=[origin[0]+c*values[0]!-s*values[1]!,origin[1]+s*values[0]!+c*values[1]!];
    if(Math.hypot(point[0]-ring[i]![0],point[1]-ring[i]![1])>maxDisplacement)throw Error('Correction exceeds reviewed displacement budget');
    return point;
  });
}
export function ringCornerErrors(ring:readonly LocalPoint[]):number[] {
  return ring.map((p,i)=>{
    const a=ring[(i+ring.length-1)%ring.length]!,b=ring[(i+1)%ring.length]!;
    const ax=a[0]-p[0],ay=a[1]-p[1],bx=b[0]-p[0],by=b[1]-p[1];
    const cosine=(ax*bx+ay*by)/(Math.hypot(ax,ay)*Math.hypot(bx,by));
    const degrees=Math.acos(Math.min(1,Math.max(-1,cosine)))*180/Math.PI;
    // A retained intermediate vertex on a straight wall is not a broken corner.
    return Math.min(Math.abs(degrees-90),Math.abs(degrees-180));
  });
}
