export function chooseRendererConfig(clipControl:boolean,dpr:number){
  return {
    antialias:true,
    reversedDepthBuffer:clipControl,
    logarithmicDepthBuffer:false,
    pixelRatio:Math.min(2,Math.max(1,dpr||1)),
  };
}
export function groundOffsetSign(reversed:boolean):1|-1{return reversed?-1:1;}
export function cameraNear(distance:number):0.1|0.5{return distance<30?0.1:0.5;}
