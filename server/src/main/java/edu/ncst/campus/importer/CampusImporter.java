package edu.ncst.campus.importer;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

/** Imports geometry from the authoritative UTM sources, never from browser GeoJSON. */
@Service
public class CampusImporter {
    private static final Logger log = LoggerFactory.getLogger(CampusImporter.class);
    private static final double ORIGIN_E = 635986.7561034276;
    private static final double ORIGIN_N = 4339716.120350528;
    private static final String UPSERT = """
        INSERT INTO campus_feature(id,name,feature_type,category,geometry,centroid,description,aliases,properties,refined,source_layer)
        SELECT ?,?,?,?, g, ST_Centroid(g), ?,?::jsonb,?::jsonb,?,?
        FROM (SELECT ST_Translate(ST_SetSRID(ST_GeomFromGeoJSON(?),32650), ?, ?) AS g) t
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,feature_type=EXCLUDED.feature_type,
          category=EXCLUDED.category,geometry=EXCLUDED.geometry,centroid=EXCLUDED.centroid,
          description=EXCLUDED.description,aliases=EXCLUDED.aliases,properties=EXCLUDED.properties,
          refined=EXCLUDED.refined,source_layer=EXCLUDED.source_layer,updated_at=now()
        """;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final Path root;
    public CampusImporter(JdbcTemplate jdbc, ObjectMapper json, @Value("${campus.data-root:..}") String root) {
        this.jdbc=jdbc; this.json=json; this.root=Path.of(root).toAbsolutePath().normalize();
    }
    private JsonNode read(String relative) {
        try { return json.readTree(Files.readString(root.resolve(relative))); }
        catch(Exception e) { throw new IllegalStateException("Missing GIS source: "+relative,e); }
    }
    private String stringify(JsonNode value) {
        try { return json.writeValueAsString(value); } catch(Exception e) { throw new IllegalArgumentException(e); }
    }
    private String property(JsonNode node,String key,String fallback) {
        JsonNode value=node.path(key);return value.isMissingNode()||value.isNull()?fallback:value.asText();
    }
    private void row(String id,String name,String type,String category,JsonNode geometry,JsonNode props,
            String source,String description,String aliases,boolean refined,double dx,double dy) {
        jdbc.update(UPSERT,id,name,type,category,description,aliases,stringify(props),refined,source,
            stringify(geometry),dx,dy);
    }
    private void sourceLayer(String source,String browser,String layer,String type,String category) {
        JsonNode raw=read(source).path("features"), converted=read(browser).path("features");
        if(raw.size()!=converted.size())throw new IllegalStateException("GIS/browser count mismatch: "+layer);
        for(int i=0;i<raw.size();i++) {
            JsonNode f=raw.get(i), b=converted.get(i);
            String id=property(b,"id","");
            if(!f.path("id").isMissingNode()&&!f.path("id").isNull()&&!f.path("id").asText().equals(id))
                throw new IllegalStateException("GIS/browser ID mismatch: "+layer+" "+i);
            String name=layer.equals("buildings")?"建筑 "+String.format("%03d",i+1):
                property(f.path("properties"),"name",type+" "+(i+1));
            row(id,name,type,category,f.path("geometry"),f.path("properties"),
                layer,"校园 GIS 原始数据；沿用 Phase 2 稳定要素 ID。","[]",false,0,0);
        }
        log.info("Imported {}: {}",layer,raw.size());
    }
    private static String stadiumId(String sourceId) {
        if(!sourceId.startsWith("ST_"))throw new IllegalArgumentException("Invalid stadium ID "+sourceId);
        return "stadium-"+sourceId.substring(3).toLowerCase().replace('_','-');
    }
    @Transactional
    public void importAll() {
        sourceLayer("output/geojson/buildings.geojson","web/public/data/buildings.geojson","buildings","建筑","building");
        sourceLayer("output/geojson/roads.geojson","web/public/data/roads.geojson","roads","道路","road");
        sourceLayer("output/geojson/waterways.geojson","web/public/data/waterways.geojson","waterways","水体","water");
        sourceLayer("output/geojson/green_areas.geojson","web/public/data/green_areas.geojson","green_areas","绿地","green");
        JsonNode boundary=read("output/debug/campus_boundary_local.geojson");
        JsonNode origin=boundary.path("metadata").path("originEPSG32650");
        if(Math.abs(origin.get(0).asDouble()-ORIGIN_E)>1e-6||Math.abs(origin.get(1).asDouble()-ORIGIN_N)>1e-6)
            throw new IllegalStateException("Campus boundary origin mismatch");
        JsonNode bf=boundary.path("features").get(0);
        row("campus-boundary-local","校园边界","校园边界","boundary",bf.path("geometry"),
            bf.path("properties"),"campus_boundary","校园局部坐标经权威 UTM 原点平移。",
            "[]",false,ORIGIN_E,ORIGIN_N);

        JsonNode inventory=read("reference/stadiums/stadium_inventory.json").path("stadiums");
        Map<String,JsonNode> stadiums=new HashMap<>();
        for(JsonNode s:inventory)stadiums.put(s.path("id").asText(),s);
        JsonNode measures=read("reference/stadiums/stadium_measurements.geojson").path("features");
        int sportCount=0;
        for(JsonNode f:measures) {
            String kind=property(f.path("properties"),"kind","");
            if(!kind.equals("track_envelope")&&!kind.equals("football_pitch"))continue;
            String sid=property(f.path("properties"),"stadiumId","");
            JsonNode s=stadiums.get(sid);
            if(s==null)throw new IllegalStateException("Unknown stadium "+sid);
            String id=stadiumId(sid)+(kind.equals("football_pitch")?"-pitch":"");
            row(id,property(s,"officialName",property(s,"planLabel",sid)),
                kind.equals("track_envelope")?"体育场":"足球场","stadium",f.path("geometry"),
                f.path("properties"),"sports","根据校园总平面图描绘的体育场近似范围。",
                kind.equals("track_envelope")?stadiumAliases(id):"[]",true,0,0);
            sportCount++;
        }
        if(sportCount!=8)throw new IllegalStateException("Expected 8 sports polygons, found "+sportCount);
        log.info("Imported sport IDs: {}",jdbc.queryForList("SELECT id FROM campus_feature WHERE source_layer='sports' ORDER BY id",String.class));
        JsonNode landmarks=read("web/public/data/landmarks.geojson").path("features");
        for(JsonNode f:landmarks) {
            JsonNode props=f.path("properties");
            String id=f.path("id").asText();
            double e=props.path("localX").asDouble()+ORIGIN_E,n=props.path("localNorth").asDouble()+ORIGIN_N;
            String point="{\"type\":\"Point\",\"coordinates\":["+e+","+n+"]}";
            try {
                row(id,property(props,"name",id),landmarkType(id),"landmark",
                    json.readTree(point),props,"landmarks","校园精修地标，位置依据 GIS 与模型校验数据。",
                    landmarkAliases(id),true,0,0);
            } catch(Exception ex){throw new IllegalStateException(ex);}
        }
        for(JsonNode s:inventory) {
            String id=stadiumId(s.path("id").asText());
            JsonNode local=s.path("centerLocalXZ");
            double e=local.get(0).asDouble()+ORIGIN_E,n=local.get(1).asDouble()+ORIGIN_N;
            try {
                row("poi-"+id,property(s,"officialName",property(s,"planLabel",id)),
                    "POI","poi",json.readTree("{\"type\":\"Point\",\"coordinates\":["+e+","+n+"]}"),
                    s,"pois","Stadium POI derived from local survey-plan center","[]",false,0,0);
            }catch(Exception ex){throw new IllegalStateException(ex);}
        }
        for(JsonNode f:landmarks) {
            JsonNode props=f.path("properties");String id=f.path("id").asText();
            double e=props.path("localX").asDouble()+ORIGIN_E,n=props.path("localNorth").asDouble()+ORIGIN_N;
            try {
                row("poi-"+id,property(props,"name",id),"POI","poi",
                    json.readTree("{\"type\":\"Point\",\"coordinates\":["+e+","+n+"]}"),
                    props,"pois","Landmark POI derived from placement report","[]",false,0,0);
            }catch(Exception ex){throw new IllegalStateException(ex);}
        }
        Map<String,String> nodes=Map.of(
            "library","LIBRARY_REFINED_ROOT","south-gate","SOUTH_GATE_REFINED_ROOT",
            "auditorium","AUDITORIUM_REFINED_ROOT","fusion-sculpture","FUS_Root",
            "stadium-east-01","ST_EAST_01_Root","stadium-east-02","ST_EAST_02_Root",
            "stadium-west-01","ST_WEST_01_Root","stadium-west-02","ST_WEST_02_Root");
        nodes.forEach((id,node)->jdbc.update("""
            INSERT INTO model_binding(feature_id,asset,node_name,model_group,refined)
            VALUES (?,'campus_refined_v005.glb',?,?,true)
            ON CONFLICT(feature_id) DO UPDATE SET asset=EXCLUDED.asset,node_name=EXCLUDED.node_name,
              model_group=EXCLUDED.model_group,refined=true
            """,id,node,id.startsWith("stadium-")?"REFINED_SPORTS":
            id.equals("fusion-sculpture")?"REFINED_LANDMARKS":"REFINED_BUILDINGS"));
        Integer count=jdbc.queryForObject("SELECT count(*) FROM campus_feature",Integer.class);
        log.info("Campus GIS import committed: {} features, {} sports geometries",count,sportCount);
    }
    private String landmarkType(String id) {
        return switch(id){case "library"->"图书馆";case "south-gate"->"校门";
            case "auditorium"->"会堂";default->"雕塑";};
    }
    private String landmarkAliases(String id) {
        return switch(id){case "library"->"[\"library\",\"图书馆\"]";
            case "south-gate"->"[\"south gate\",\"南门\",\"学校南门\"]";
            case "auditorium"->"[\"auditorium\",\"会堂\",\"校会堂\"]";
            default->"[\"融合\",\"融合雕塑\"]";};
    }
    private String stadiumAliases(String id) {
        return switch(id){case "stadium-east-01"->"[\"东区一号体育场\",\"东一体育场\",\"east stadium 01\"]";
            case "stadium-east-02"->"[\"东区二号体育场\",\"东二体育场\",\"east stadium 02\"]";
            case "stadium-west-01"->"[\"西区一号体育场\",\"西一体育场\",\"west stadium 01\"]";
            default->"[\"西区二号体育场\",\"西二体育场\",\"west stadium 02\"]";};
    }
}
