import { type Object3D, type Mesh, type Material, Texture } from 'three';
export function disposeModel(root:Object3D) {
  const geometries=new Set<Mesh['geometry']>(),materials=new Set<Material>(),textures=new Set<Texture>();
  root.traverse(o=>{const m=o as Mesh;if(m.geometry)geometries.add(m.geometry);if(m.material)(Array.isArray(m.material)?m.material:[m.material]).forEach(v=>materials.add(v));});
  materials.forEach(m=>Object.values(m).forEach(v=>{if(v instanceof Texture)textures.add(v);}));
  textures.forEach(t=>{const image=t.source.data;if(typeof ImageBitmap!=='undefined' && image instanceof ImageBitmap)image.close();t.dispose();});
  materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());root.clear();
}
