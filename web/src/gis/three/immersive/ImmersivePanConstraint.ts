import type {Box3, Vector3} from 'three';

/** Clamp the pan target and translate the camera by the SAME amount.
 * Clamping only the target changes orbit distance/angle and creates a rebound.
 */
export function constrainCampusPan(position:Vector3,target:Vector3,bounds:Box3):boolean {
  if(bounds.isEmpty())return false;
  const x=Math.min(bounds.max.x+120,Math.max(bounds.min.x-120,target.x));
  const y=Math.min(bounds.max.y+120,Math.max(bounds.min.y-120,target.y));
  const z=Math.min(130,Math.max(-25,target.z));
  if(x===target.x&&y===target.y&&z===target.z)return false;
  position.x+=x-target.x;position.y+=y-target.y;position.z+=z-target.z;
  target.set(x,y,z);return true;
}
