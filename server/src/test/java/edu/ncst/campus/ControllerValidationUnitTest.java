package edu.ncst.campus;

import edu.ncst.campus.analysis.AnalysisController;
import edu.ncst.campus.feature.FeatureController;
import edu.ncst.campus.feature.FeatureRepository;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ControllerValidationUnitTest {
    private final FeatureRepository repository=mock(FeatureRepository.class);
    private final FeatureController features=new FeatureController(repository);
    @Test void invalidFeatureListLimitAndBboxAreRejected() {
        assertThrows(IllegalArgumentException.class,()->features.all(null,null,null,1001,false));
        assertThrows(IllegalArgumentException.class,()->features.all(null,null,"118.6,39.2,118.5,39.3",10,false));
    }
    @Test void blankSearchAndMissingFeatureAreRejected() {
        assertThrows(IllegalArgumentException.class,()->features.search("  ",10));
        when(repository.byId("not-real")).thenReturn(null);
        assertThrows(ResponseStatusException.class,()->features.one("not-real"));
    }
    @Test void malformedGeojsonIsRejectedBeforeSpatialSql() {
        ObjectMapper mapper=new ObjectMapper();
        AnalysisController analysis=new AnalysisController(mock(JdbcTemplate.class),mapper,mock(FeatureRepository.class));
        assertThrows(IllegalArgumentException.class,()->analysis.buffer(new AnalysisController.BufferRequest(
            mapper.readTree("{\"type\":\"Point\",\"coordinates\":[1,2],\"crs\":{\"type\":\"name\"}}"),100.0)));
    }
}
