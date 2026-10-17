import type { CampusFeature } from '../../types/CampusFeature';

/** Exact landmark names/aliases lead their retained raw GIS footprints.
 * IDs and historical aliases still retrieve those independent records. */
export function rankFeatureSearch(features:CampusFeature[],query:string):CampusFeature[] {
  const normalize=(value:string)=>value.trim().toLocaleLowerCase();
  const q=normalize(query);if(!q)return [];
  const score=(feature:CampusFeature)=>{
    const name=normalize(feature.name),aliases=feature.aliases.map(normalize);
    if(name===q||aliases.includes(q))return feature.category==='landmark'&&feature.refined?-1:0;
    if(name.startsWith(q))return 2;if(name.includes(q))return 3;
    if(aliases.some(alias=>alias.includes(q)))return 4;
    if([...feature.keywords,feature.type].some(word=>normalize(word).includes(q)))return 5;
    return Infinity;
  };
  return features.filter(feature=>score(feature)<Infinity)
    .sort((a,b)=>score(a)-score(b)||a.name.localeCompare(b.name,'zh-CN'));
}
