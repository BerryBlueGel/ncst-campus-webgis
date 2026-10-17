package edu.ncst.campus.analysis;

import edu.ncst.campus.feature.FeatureRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DataAccessException;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/analysis")
public class AnalysisController {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final FeatureRepository features;
    public AnalysisController(JdbcTemplate jdbc,ObjectMapper json,FeatureRepository features){
        this.jdbc=jdbc;this.json=json;this.features=features;
    }
    public record PointRequest(
        @NotNull @DecimalMin("-180") @DecimalMax("180") Double longitude,
        @NotNull @DecimalMin("-90") @DecimalMax("90") Double latitude,
        List<String> types) {}
    public record NearbyRequest(
        @NotNull @DecimalMin("-180") @DecimalMax("180") Double longitude,
        @NotNull @DecimalMin("-90") @DecimalMax("90") Double latitude,
        @NotNull @DecimalMin(value="0.0",inclusive=false) @DecimalMax("5000") Double radiusMeters,
        List<String> types) {}
    public record GeometryRequest(@NotNull JsonNode geometry) {}
    public record BufferRequest(@NotNull JsonNode geometry,
        @NotNull @DecimalMin(value="0.0",inclusive=false) @DecimalMax("5000") Double radiusMeters) {}
    public record WithinRequest(
        @NotNull @DecimalMin("-180") @DecimalMax("180") Double longitude,
        @NotNull @DecimalMin("-90") @DecimalMax("90") Double latitude,
        String featureId,JsonNode geometry) {}
    public record IntersectionRequest(String featureIdA,String featureIdB,
        JsonNode geometry, String targetFeatureId) {}
    private String geometry(JsonNode g) {
        if(g==null||g.isNull())throw new IllegalArgumentException("GeoJSON geometry required");
        JsonNode actual=g.has("geometry")?g.path("geometry"):g;
        if(actual.path("type").asText().isBlank()||!actual.has("coordinates")||actual.has("crs"))
            throw new IllegalArgumentException("Valid GeoJSON geometry required");
        String value=json.writeValueAsString(actual);
        try {
            Boolean valid=jdbc.queryForObject("""
                WITH g AS (SELECT ST_GeomFromGeoJSON(?) AS geom)
                SELECT ST_IsValid(geom) AND NOT ST_IsEmpty(geom)
                  AND ST_XMin(geom)>=-180 AND ST_XMax(geom)<=180
                  AND ST_YMin(geom)>=-90 AND ST_YMax(geom)<=90 FROM g
                """,Boolean.class,value);
            if(!Boolean.TRUE.equals(valid))throw new IllegalArgumentException("Invalid WGS84 GeoJSON geometry");
        } catch(DataAccessException ex) {
            throw new IllegalArgumentException("Invalid WGS84 GeoJSON geometry");
        }
        return value;
    }
    @SuppressWarnings("unchecked")
    private Map<String,Object> parse(String value){return json.readValue(value,Map.class);}
    private String pointSql(){
        return "ST_Transform(ST_SetSRID(ST_MakePoint(?,?),4326),32650)";
    }
    private Map<String,Object> geometryResult(String sql,Object... args){
        return jdbc.queryForObject(sql,(rs,i)->{
            Map<String,Object> m=new LinkedHashMap<>();
            m.put("geometry",parse(rs.getString("geometry")));
            return m;
        },args);
    }
    @PostMapping("/nearby")
    public List<Map<String,Object>> nearby(@Valid @RequestBody NearbyRequest r){
        String filter=r.types()==null||r.types().isEmpty()?null:String.join(",",r.types());
        String sql="""
            WITH p AS (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(?,?),4326),32650) AS geom)
            SELECT f.id,f.name,f.category,ST_Distance(f.geometry,p.geom) AS distance_meters
            FROM campus_feature f CROSS JOIN p
            WHERE ST_DWithin(f.geometry,p.geom,?)
              AND (?::text IS NULL OR f.category=ANY(string_to_array(?::text,',')))
              AND f.id NOT LIKE '%-pitch'
            ORDER BY distance_meters,f.id LIMIT 100
            """;
        return jdbc.query(sql,(rs,i)->Map.of("id",rs.getString("id"),"name",rs.getString("name"),
            "category",rs.getString("category"),"distanceMeters",rs.getDouble("distance_meters")),
            r.longitude(),r.latitude(),r.radiusMeters(),filter,filter);
    }
    @PostMapping("/nearest")
    public Map<String,Object> nearest(@Valid @RequestBody PointRequest r){
        String filter=r.types()==null||r.types().isEmpty()?null:String.join(",",r.types());
        String sql="""
            WITH p AS (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(?,?),4326),32650) AS geom)
            SELECT f.id,ST_Distance(f.geometry,p.geom) AS distance_meters
            FROM campus_feature f CROSS JOIN p
            WHERE (f.category IN ('building','landmark','stadium') OR (?::text='poi' AND f.category='poi'))
              AND f.id NOT LIKE '%-pitch'
              AND (?::text IS NULL OR f.category=ANY(string_to_array(?::text,',')))
            ORDER BY f.geometry <-> p.geom, f.id LIMIT 1
            """;
        List<Map<String,Object>> rows=jdbc.query(sql,(rs,i)->Map.of("id",rs.getString("id"),
            "distanceMeters",rs.getDouble("distance_meters")),
            r.longitude(),r.latitude(),filter,filter,filter);
        if(rows.isEmpty())return Map.of("feature",Map.of(),"distanceMeters",0);
        Map<String,Object> row=rows.getFirst();
        return Map.of("feature",features.byId((String)row.get("id")),
            "distanceMeters",row.get("distanceMeters"));
    }
    @PostMapping("/buffer")
    public Map<String,Object> buffer(@Valid @RequestBody BufferRequest r){
        String sql="""
            SELECT ST_AsGeoJSON(ST_Transform(ST_Buffer(
              ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(?),4326),32650),?),4326)) AS geometry
            """;
        Map<String,Object> out=geometryResult(sql,geometry(r.geometry()),r.radiusMeters());
        out.put("radiusMeters",r.radiusMeters());return out;
    }
    @PostMapping("/distance")
    public Map<String,Object> distance(@Valid @RequestBody GeometryRequest r){
        Double result=jdbc.queryForObject("""
            SELECT ST_Length(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(?),4326),32650))
            """,Double.class,geometry(r.geometry()));
        return Map.of("distanceMeters",result);
    }
    @PostMapping("/area")
    public Map<String,Object> area(@Valid @RequestBody GeometryRequest r){
        Double result=jdbc.queryForObject("""
            SELECT ST_Area(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(?),4326),32650))
            """,Double.class,geometry(r.geometry()));
        return Map.of("areaSquareMeters",result);
    }
    @PostMapping("/within")
    public Map<String,Object> within(@Valid @RequestBody WithinRequest r){
        if((r.featureId()==null)==(r.geometry()==null))
            throw new IllegalArgumentException("Provide exactly one target featureId or geometry");
        boolean inside;
        if(r.featureId()!=null) {
            List<Boolean> rows=jdbc.query("""
                SELECT ST_Within(ST_Transform(ST_SetSRID(ST_MakePoint(?,?),4326),32650),geometry)
                FROM campus_feature WHERE id=?
                """,(rs,i)->rs.getBoolean(1),r.longitude(),r.latitude(),r.featureId());
            if(rows.isEmpty())throw new IllegalArgumentException("Unknown target feature");
            inside=rows.getFirst();
        } else {
            inside=Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT ST_Within(ST_Transform(ST_SetSRID(ST_MakePoint(?,?),4326),32650),
                  ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(?),4326),32650))
                """,Boolean.class,r.longitude(),r.latitude(),geometry(r.geometry())));
        }
        return Map.of("within",inside,"boundaryCountsAsWithin",false);
    }
    @PostMapping("/intersection")
    public Map<String,Object> intersection(@RequestBody IntersectionRequest r) {
        String aSql,bSql;
        Object[] args;
        if(r.featureIdA()!=null&&r.featureIdB()!=null){
            aSql="(SELECT geometry FROM campus_feature WHERE id=?)";
            bSql="(SELECT geometry FROM campus_feature WHERE id=?)";
            args=new Object[]{r.featureIdA(),r.featureIdB()};
        } else if(r.geometry()!=null&&r.targetFeatureId()!=null) {
            aSql="ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(?),4326),32650)";
            bSql="(SELECT geometry FROM campus_feature WHERE id=?)";
            args=new Object[]{geometry(r.geometry()),r.targetFeatureId()};
        } else throw new IllegalArgumentException("Provide two feature IDs or geometry plus targetFeatureId");
        String sql="WITH g AS (SELECT "+aSql+" AS a,"+bSql+" AS b) "+
            "SELECT ST_Intersects(a,b) AS intersects,"+
            "CASE WHEN ST_Intersects(a,b) THEN ST_AsGeoJSON(ST_Transform(ST_Intersection(a,b),4326)) END AS geometry,"+
            "CASE WHEN ST_Intersects(a,b) THEN ST_Area(ST_Intersection(a,b)) ELSE 0 END AS area "+
            "FROM g";
        return jdbc.queryForObject(sql,(rs,i)->{
            Map<String,Object> out=new LinkedHashMap<>();
            out.put("intersects",rs.getBoolean("intersects"));
            String g=rs.getString("geometry");out.put("geometry",g==null?null:parse(g));
            out.put("areaSquareMeters",rs.getDouble("area"));return out;
        },args);
    }
}
