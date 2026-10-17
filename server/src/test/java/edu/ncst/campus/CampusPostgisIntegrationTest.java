package edu.ncst.campus;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import static org.junit.jupiter.api.Assertions.*;

/** Runs against the real local PostGIS Compose service, never H2. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties="campus.import-on-start=true")
@ActiveProfiles("test")
class CampusPostgisIntegrationTest {
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    private HttpResponse<String> request(String path,String body) throws Exception {
        HttpRequest.Builder builder=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1"+path))
            .timeout(Duration.ofSeconds(20));
        if(body==null)builder.GET();
        else builder.header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body));
        return client.send(builder.build(),HttpResponse.BodyHandlers.ofString());
    }
    private JsonNode ok(String path,String body) throws Exception {
        HttpResponse<String> response=request(path,body);
        assertEquals(200,response.statusCode(),response.body());
        return json.readTree(response.body());
    }
    @Test void migrationsImportAndGeometryAuthority() {
        assertNotNull(jdbc.queryForObject("SELECT PostGIS_Full_Version()",String.class));
        assertEquals(4,jdbc.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history WHERE success",Integer.class));
        assertEquals(449,jdbc.queryForObject("SELECT count(*) FROM campus_feature",Integer.class));
        assertEquals(0,jdbc.queryForObject("""
            SELECT count(*) FROM campus_feature
            WHERE ST_SRID(geometry)<>32650 OR NOT ST_IsValid(geometry) OR ST_IsEmpty(geometry)
            """,Integer.class));
        assertEquals(8,jdbc.queryForObject("SELECT count(*) FROM model_binding",Integer.class));
        assertTrue(jdbc.queryForObject("""
            SELECT count(*)>0 FROM pg_indexes
            WHERE tablename='campus_feature' AND indexdef LIKE '%USING gist (geometry)%'
            """,Boolean.class));
    }
    @Test void featuresSearchAndWgs84() throws Exception {
        JsonNode library=ok("/features/library",null);
        assertEquals("library",library.path("id").asText());
        assertEquals("Point",library.path("geometry").path("type").asText());
        assertEquals(118.5863,library.path("geometry").path("coordinates").get(0).asDouble(),0.001);
        assertEquals(39.2009,library.path("geometry").path("coordinates").get(1).asDouble(),0.001);
        assertEquals("library",ok("/search?q=library",null).get(0).path("id").asText());
        assertEquals("south-gate",ok("/search?q=%E5%8D%97%E9%97%A8",null).get(0).path("id").asText());
        assertTrue(ok("/search?q=%E4%BC%9A%E5%A0%82",null).size()>0);
        assertTrue(ok("/search?q=%E4%BD%93%E8%82%B2%E5%9C%BA",null).size()>0);
        assertEquals(404,request("/features/not-real",null).statusCode());
        assertEquals(5,ok("/features?bbox=118.58,39.19,118.60,39.21&limit=5",null).path("features").size());
    }
    @Test void spatialPredicatesAndMetrics() throws Exception {
        assertTrue(ok("/analysis/nearby", """
            {"longitude":118.5863,"latitude":39.2009,"radiusMeters":300}
            """).size()>0);
        assertTrue(ok("/analysis/nearest", """
            {"longitude":118.5863,"latitude":39.2009}
            """).path("feature").has("id"));
        assertTrue(ok("/analysis/within", """
            {"longitude":118.5863,"latitude":39.2009,"featureId":"campus-boundary-local"}
            """).path("within").asBoolean());
        assertFalse(ok("/analysis/within", """
            {"longitude":118.7,"latitude":39.3,"featureId":"campus-boundary-local"}
            """).path("within").asBoolean());
        assertTrue(ok("/analysis/intersection", """
            {"featureIdA":"stadium-east-01","featureIdB":"stadium-east-01"}
            """).path("intersects").asBoolean());
        assertEquals("Polygon",ok("/analysis/buffer", """
            {"geometry":{"type":"Point","coordinates":[118.5863,39.2009]},"radiusMeters":300}
            """).path("geometry").path("type").asText());
        assertTrue(ok("/analysis/distance", """
            {"geometry":{"type":"LineString","coordinates":[[118.5861,39.1964],[118.5863,39.2009]]}}
            """).path("distanceMeters").asDouble()>400);
        assertTrue(ok("/analysis/area", """
            {"geometry":{"type":"Polygon","coordinates":[[[118.586,39.200],[118.587,39.200],[118.587,39.201],[118.586,39.201],[118.586,39.200]]]}}
            """).path("areaSquareMeters").asDouble()>9000);
    }
    @Test void validationAndErrors() throws Exception {
        HttpResponse<String> bad=request("/analysis/buffer", """
            {"geometry":{"type":"Point","coordinates":[118.5863,39.2009]},"radiusMeters":-1}
            """);
        assertEquals(400,bad.statusCode());
        assertEquals("BAD_REQUEST",json.readTree(bad.body()).path("code").asText());
        assertEquals(400,request("/features?bbox=1,2,3",null).statusCode());
        assertEquals(400,request("/analysis/buffer", """
            {"geometry":{"type":"Point","coordinates":[200,95]},"radiusMeters":100}
            """).statusCode());
    }
}
