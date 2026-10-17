export interface CameraState {
  lng: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
}
export interface LayerMetadata {
  id: string;
  name: string;
  type: "fill" | "line" | "symbol";
  visible: boolean;
  opacity: number;
  group: string;
}
export type { CampusFeature } from './CampusFeature';
