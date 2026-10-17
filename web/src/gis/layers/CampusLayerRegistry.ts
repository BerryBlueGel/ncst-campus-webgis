import type {
  LayerSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
  CircleLayerSpecification,
} from "maplibre-gl";
import { CampusMapStyle as c } from "./CampusMapStyle";
import { SOURCE_FRAGMENT_LAYER,SOURCE_FRAGMENT_ROLE,sourceFragmentOpacity } from './SourceFragmentDisplay';
export interface CampusLayerDefinition {
  id: string;
  name: string;
  group: string;
  sourceId: string;
  url: string;
  geometryType: string[];
  defaultVisible: boolean;
  defaultOpacity: number;
  minZoom: number;
  maxZoom: number;
  style: LayerSpecification[];
}
function def(
  id: string,
  name: string,
  group: string,
  file: string,
  geometryType: string[],
  style: LayerSpecification[],
): CampusLayerDefinition {
  return {
    id,
    name,
    group,
    sourceId: "campus-" + id,
    url: "/data/" + file + ".geojson",
    geometryType,
    defaultVisible: true,
    // Opaque footprints avoid showing landscape polygons through roofs by default.
    defaultOpacity: id === 'buildings' ? 1 : 0.9,
    minZoom: 0,
    maxZoom: 24,
    style,
  };
}
const polygon = ["Polygon", "MultiPolygon"],
  line = ["LineString", "MultiLineString"];
function fill(id: string, color: string): FillLayerSpecification {
  return {
    id: id + "-fill",
    source: "campus-" + id,
    type: "fill",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": color, "fill-outline-color": c.outline },
  };
}
function stroke(
  id: string,
  color: string,
  width: number,
): LineLayerSpecification {
  return {
    id: id + "-line",
    source: "campus-" + id,
    type: "line",
    paint: { "line-color": color, "line-width": width },
  };
}
function circle(
  id: string,
  color: string,
  radius: number,
): CircleLayerSpecification {
  return {
    id: id + "-circle",
    source: "campus-" + id,
    type: "circle",
    paint: {
      "circle-color": color,
      "circle-radius": radius,
      "circle-stroke-color": c.halo,
      "circle-stroke-width": 1.5,
    },
  };
}
export const CAMPUS_LAYERS: CampusLayerDefinition[] = [
  def("green-areas", "绿地", "自然环境", "green_areas", polygon, [
    fill("green-areas", c.green),
  ]),
  def(
    "waterways",
    "水体",
    "自然环境",
    "waterways",
    [...polygon, ...line],
    [
      fill("waterways", c.water),
      {
        ...stroke("waterways", c.water, 3),
        filter: ["==", ["geometry-type"], "LineString"],
      },
    ],
  ),
  def("buildings", "建筑", "建筑设施", "buildings", polygon, [
    {...fill("buildings", c.building),filter:['all',['==',['geometry-type'],'Polygon'],['!=',['get','displayRole'],SOURCE_FRAGMENT_ROLE]]},
    {id:SOURCE_FRAGMENT_LAYER,source:'campus-buildings',type:'line',filter:['==',['get','displayRole'],SOURCE_FRAGMENT_ROLE],
      paint:{'line-color':'#b7791f','line-width':2,'line-dasharray':[2,2],'line-opacity':sourceFragmentOpacity(false,1)}},
  ]),
  def("roads", "道路", "基础数据", "roads", line, [
    {
      ...stroke("roads", c.road, 2),
      paint: {
        "line-color": c.road,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          1,
          18,
          ["max", 1, ["*", ["coalesce", ["get", "width"], 2], 0.65]],
        ],
      },
    },
  ]),
  def("sports", "体育设施", "建筑设施", "sports", polygon, [
    {
      ...fill("sports", c.track),
      paint: {
        "fill-color": [
          "match",
          ["get", "kind"],
          "football_pitch",
          c.pitch,
          c.track,
        ],
        "fill-outline-color": c.outline,
      },
    },
  ]),
  def("campus-boundary", "校园边界", "基础数据", "campus_boundary", polygon, [
    {
      ...stroke("campus-boundary", c.boundary, 2.5),
      paint: {
        "line-color": c.boundary,
        "line-width": 2.5,
        "line-dasharray": [3, 2],
      },
    },
  ]),
  def("poi", "兴趣点", "地标", "pois", ["Point"], [circle("poi", c.poi, 7)]),
  def(
    "landmarks",
    "地标",
    "地标",
    "landmarks",
    ["Point"],
    [circle("landmarks", c.landmark, 4)],
  ),
];
