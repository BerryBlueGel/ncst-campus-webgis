import type {CampusFeature} from '../../types/CampusFeature';
import {reviewedDisplayGroup} from '../layers/CampusCompoundDisplay';

/** Search presentation only. Explicit source-number queries retain source IDs. */
export function displaySearchResults(matches:readonly CampusFeature[],query:string,grouped:boolean,lookup:(id:string)=>CampusFeature|undefined):CampusFeature[]{
  if(!grouped||/^建筑\s*\d+$/u.test(query.trim()))return matches.slice(0,8);
  const seen=new Set<string>(),results:CampusFeature[]=[];
  for(const match of matches){
    const group=match.category==='building'?reviewedDisplayGroup(match.id):undefined;
    const id=group?.root??match.id;if(seen.has(id))continue;seen.add(id);
    const root=group?lookup(id):undefined;
    // If an API root is unavailable, keep the matched source, not a fake record.
    const name=root&&group&&(root.properties.mapLabel===root.name||root.name===group.name)?group.name:root?.name;
    results.push(root&&group?{...root,name:name!}:match);
    if(results.length===8)break;
  }
  return results;
}
