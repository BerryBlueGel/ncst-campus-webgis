import type { StyleSpecification } from "maplibre-gl";
export interface BaseMapProvider {
  id: string;
  name: string;
  style(): string | StyleSpecification;
}
export class DefaultOpenMapProvider implements BaseMapProvider {
  id = "open-map";
  name = "开放街道地图";
  style(): string | StyleSpecification {
    return (
      import.meta.env.VITE_MAP_STYLE_URL?.trim() || {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 19,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
          },
        },
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#edf7fd" },
          },
          { id: "open-map", type: "raster", source: "osm" },
        ],
      }
    );
  }
}
