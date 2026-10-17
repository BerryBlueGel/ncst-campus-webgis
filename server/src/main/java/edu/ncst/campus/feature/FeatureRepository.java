package edu.ncst.campus.feature;

import tools.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Repository
public class FeatureRepository {
    private static final String SELECT = """
        SELECT f.id,f.name,f.feature_type,f.category,f.description,f.refined,f.source_layer,
          f.aliases::text AS aliases_json,f.properties::text AS properties_json,
          ST_AsGeoJSON(ST_Transform(f.geometry,4326)) AS geometry_json,
          ST_X(ST_Transform(f.centroid,4326)) AS longitude,
          ST_Y(ST_Transform(f.centroid,4326)) AS latitude,
          ST_XMin(ST_Envelope(ST_Transform(f.geometry,4326))) AS west,
          ST_YMin(ST_Envelope(ST_Transform(f.geometry,4326))) AS south,
          ST_XMax(ST_Envelope(ST_Transform(f.geometry,4326))) AS east,
          ST_YMax(ST_Envelope(ST_Transform(f.geometry,4326))) AS north,
          m.node_name AS model_binding
        FROM campus_feature f LEFT JOIN model_binding m ON m.feature_id=f.id
        """;
    private final NamedParameterJdbcTemplate named;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public FeatureRepository(NamedParameterJdbcTemplate named,JdbcTemplate jdbc,ObjectMapper json) {
        this.named=named;this.jdbc=jdbc;this.json=json;
    }
    @SuppressWarnings("unchecked")
    private Map<String,Object> parseObject(String value) {
        return json.readValue(value,Map.class);
    }
    @SuppressWarnings("unchecked")
    private List<String> parseList(String value) {
        return json.readValue(value,List.class);
    }
    private Map<String,Object> decode(Map<String,Object> row) {
        Map<String,Object> f=new LinkedHashMap<>();
        String id=(String)row.get("id"),category=(String)row.get("category");
        f.put("id",id);f.put("name",row.get("name"));f.put("type",row.get("feature_type"));
        f.put("category",category);f.put("geometry",parseObject((String)row.get("geometry_json")));
        f.put("centroid",List.of(row.get("longitude"),row.get("latitude")));
        if(!"landmark".equals(category)&&!"poi".equals(category))
            f.put("bounds",List.of(List.of(row.get("west"),row.get("south")),
                List.of(row.get("east"),row.get("north"))));
        f.put("description",row.get("description"));f.put("properties",parseObject((String)row.get("properties_json")));
        f.put("aliases",parseList((String)row.get("aliases_json")));
        f.put("refined",row.get("refined"));
        f.put("modelBinding",row.get("model_binding"));
        f.put("keywords",switch(category==null?"":category) {
            case "stadium"->List.of("体育场","操场","田径场");
            case "building"->List.of("建筑");
            default->List.of("校园地标");
        });
        String source=(String)row.get("source_layer");
        List<Map<String,String>> bindings=new ArrayList<>();
        String sourceId="campus-"+source;
        if("green_areas".equals(source))sourceId="campus-green";
        if("landmark".equals(category))sourceId="campus-landmarks";
        if("stadium".equals(category)) {
            bindings.add(Map.of("source","campus-sports","id",id));
            bindings.add(Map.of("source","campus-sports","id",id+"-pitch"));
        } else if("building".equals(category)||"landmark".equals(category))
            bindings.add(Map.of("source",sourceId,"id",id));
        if(id.equals("library")||id.equals("auditorium")) {
            List<String> footprints=jdbc.queryForList("""
                SELECT b.id FROM campus_feature b WHERE b.category='building'
                  AND ST_Covers(b.geometry,(SELECT centroid FROM campus_feature WHERE id=?))
                """,String.class,id);
            for(String footprint:footprints)bindings.add(Map.of("source","campus-buildings","id",footprint));
        }
        if("landmark".equals(category)||"stadium".equals(category))
            bindings.add(Map.of("source","campus-poi","id","poi-"+id));
        f.put("gisBindings",bindings);
        return f;
    }
    private List<Map<String,Object>> query(String where,MapSqlParameterSource params,String order,int limit) {
        String sql=SELECT+" WHERE "+where+" ORDER BY "+order+" LIMIT :limit";
        params.addValue("limit",limit);
        return named.query(sql,params,(rs,n)->{
            Map<String,Object> row=new LinkedHashMap<>();
            for(String key:List.of("id","name","feature_type","category","description","source_layer",
                "aliases_json","properties_json","geometry_json","model_binding"))
                row.put(key,rs.getString(key));
            row.put("refined",rs.getBoolean("refined"));
            for(String key:List.of("longitude","latitude","west","south","east","north"))
                row.put(key,rs.getDouble(key));
            return decode(row);
        });
    }
    public List<Map<String,Object>> list(String type,String category,double[] bbox,int limit,boolean businessOnly) {
        StringBuilder where=new StringBuilder("true");
        MapSqlParameterSource p=new MapSqlParameterSource();
        if(type!=null&&!type.isBlank()){where.append(" AND f.feature_type=:type");p.addValue("type",type);}
        if(category!=null&&!category.isBlank()){where.append(" AND f.category=:category");p.addValue("category",category);}
        if(businessOnly)where.append(" AND (f.category IN ('building','landmark') OR (f.category='stadium' AND f.id NOT LIKE '%-pitch'))");
        if(bbox!=null){
            where.append(" AND ST_Intersects(f.geometry,ST_Transform(ST_MakeEnvelope(:west,:south,:east,:north,4326),32650))");
            p.addValue("west",bbox[0]).addValue("south",bbox[1]).addValue("east",bbox[2]).addValue("north",bbox[3]);
        }
        return query(where.toString(),p,"f.id",limit);
    }
    public Map<String,Object> byId(String id) {
        List<Map<String,Object>> rows=query("f.id=:id",new MapSqlParameterSource("id",id),"f.id",1);
        return rows.isEmpty()?null:rows.getFirst();
    }
    public List<Map<String,Object>> search(String q,int limit) {
        String query=q.trim().toLowerCase();
        MapSqlParameterSource p=new MapSqlParameterSource().addValue("q",query).addValue("contains","%"+query+"%");
        String where="""
            (f.category IN ('building','landmark') OR (f.category='stadium' AND f.id NOT LIKE '%-pitch'))
            AND (lower(f.name) LIKE :contains OR lower(f.aliases::text) LIKE :contains
                 OR lower(f.feature_type) LIKE :contains OR lower(f.id) LIKE :contains)
            """;
        String rank="""
            CASE WHEN lower(f.name)=:q THEN 0
              WHEN jsonb_exists(f.aliases,:q) THEN 1
              WHEN lower(f.name) LIKE :q || '%' THEN 2
              WHEN lower(f.name) LIKE :contains THEN 3
              ELSE 4 END, f.name
            """;
        return query(where,p,rank,limit);
    }
    public List<Map<String,Object>> layers() {
        return jdbc.query("SELECT source_layer AS layer,count(*) AS feature_count FROM campus_feature GROUP BY source_layer ORDER BY source_layer",
            (rs,i)->Map.of("layer",rs.getString("layer"),"featureCount",rs.getInt("feature_count")));
    }
    public Map<String,Object> overview() {
        Map<String,Object> out=new LinkedHashMap<>();
        out.put("totalFeatures",jdbc.queryForObject("SELECT count(*) FROM campus_feature",Integer.class));
        out.put("buildingCount",jdbc.queryForObject("SELECT count(*) FROM campus_feature WHERE category='building'",Integer.class));
        out.put("sportsCount",jdbc.queryForObject("SELECT count(*) FROM campus_feature WHERE category='stadium' AND id NOT LIKE '%-pitch'",Integer.class));
        out.put("roadLengthMeters",jdbc.queryForObject("SELECT coalesce(sum(ST_Length(geometry)),0) FROM campus_feature WHERE category='road'",Double.class));
        out.put("greenAreaSquareMeters",jdbc.queryForObject("SELECT coalesce(sum(ST_Area(geometry)),0) FROM campus_feature WHERE category='green'",Double.class));
        out.put("waterAreaSquareMeters",jdbc.queryForObject("SELECT coalesce(sum(ST_Area(geometry)),0) FROM campus_feature WHERE category='water'",Double.class));
        out.put("layers",layers());
        return out;
    }
}
