/** Work scheduling sectors in local meters, NOT authoritative land-use boundaries.
 * Membership uses the source bounding-box center, not a name or guessed ownership.
 */
export function buildingReviewSector([west,south,east,north]:readonly number[]):string{
  const x=(west!+east!)/2,y=(south!+north!)/2;
  if(x<260)return 'west-edge-sports-and-services';
  if(x>1690)return 'east-edge-sports-and-services';
  if(y<370)return x<760?'southwest-academic':x>1230?'southeast-academic':'south-axis-and-gate';
  if(x<760)return y<870?'west-living-south':y<1120?'west-living-north':'northwest-academic-and-services';
  if(x>1230)return y<870?'east-living-south':y<1180?'east-living-north':'northeast-academic-and-services';
  return y<630?'library-and-forecourt':y<1110?'central-teaching':y<1350?'auditorium-and-lake':'north-landscape-and-services';
}
