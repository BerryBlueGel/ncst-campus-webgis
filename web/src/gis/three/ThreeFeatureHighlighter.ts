import { Color, type Material, type Mesh, type Object3D } from 'three';
import type { ModelNodeIndex } from './ModelNodeIndex';

type ColorMaterial=Material & {color?:Color;emissive?:Color;emissiveIntensity?:number};
type Saved={mesh:Mesh;original:Material|Material[];highlight:Material|Material[]};

export class ThreeFeatureHighlighter {
  private prepared=new Map<string,Saved[]>();
  private selected:string|null=null;private hovered:string|null=null;
  constructor(private index:ModelNodeIndex){}
  private prepare(id:string){
    if(this.prepared.has(id))return this.prepared.get(id)!;
    const saved:Saved[]=[];
    for(const root of this.index.get(id)??[])root.traverse((node:Object3D)=>{
      const mesh=node as Mesh;if(!mesh.isMesh||!mesh.material||mesh.userData.campusBatchedSource)return;
      const original=mesh.material as Material|Material[];
      const highlight=Array.isArray(original)?original.map(m=>m.clone()):original.clone();
      saved.push({mesh,original,highlight});
    });
    this.prepared.set(id,saved);return saved;
  }
  private updateOne(id:string){
    const level=id===this.selected?2:id===this.hovered?1:0;
    for(const entry of this.prepared.get(id)??[]){
      if(!level){entry.mesh.material=entry.original;continue;}
      const source=Array.isArray(entry.original)?entry.original:[entry.original];
      const target=Array.isArray(entry.highlight)?entry.highlight:[entry.highlight];
      target.forEach((material,index)=>{
        const base=source[index] as ColorMaterial,copy=material as ColorMaterial;
        if(base.color&&copy.color)copy.color.copy(base.color).lerp(new Color(level===2?'#63b9f0':'#b3def8'),level===2?0.46:0.24);
        if(base.emissive&&copy.emissive){copy.emissive.copy(base.emissive).lerp(new Color(level===2?'#2585c2':'#77b9df'),level===2?0.42:0.18);copy.emissiveIntensity=level===2?0.7:0.35;}
      });
      entry.mesh.material=entry.highlight;
    }
  }
  set(selected:string|null,hovered:string|null){
    const previous=[this.selected,this.hovered];this.selected=selected;this.hovered=hovered;
    for(const id of new Set([...previous,selected,hovered]))if(id){this.prepare(id);this.updateOne(id);}
  }
  dispose(){
    for(const entries of this.prepared.values())for(const entry of entries){
      entry.mesh.material=entry.original;
      const materials=Array.isArray(entry.highlight)?entry.highlight:[entry.highlight];materials.forEach(m=>m.dispose());
    }
    this.prepared.clear();
  }
}
