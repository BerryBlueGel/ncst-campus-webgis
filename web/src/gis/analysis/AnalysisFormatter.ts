export const formatDistance=(meters:number)=>meters<1000?`${meters.toFixed(2)} m`:`${(meters/1000).toFixed(3)} km`;
export const formatArea=(squareMeters:number)=>squareMeters<10000?`${squareMeters.toFixed(2)} m²`:`${squareMeters.toFixed(2)} m² / ${(squareMeters/10000).toFixed(3)} ha`;
