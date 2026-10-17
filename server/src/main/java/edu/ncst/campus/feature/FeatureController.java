package edu.ncst.campus.feature;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1")
public class FeatureController {
    private final FeatureRepository features;
    public FeatureController(FeatureRepository features){this.features=features;}

    @GetMapping("/features")
    public Map<String,Object> all(@RequestParam(required=false) String type,
        @RequestParam(required=false) String category,@RequestParam(required=false) String bbox,
        @RequestParam(defaultValue="500") int limit,@RequestParam(defaultValue="false") boolean businessOnly) {
        if(limit<1||limit>1000)throw new IllegalArgumentException("limit must be 1..1000");
        double[] bounds=null;
        if(bbox!=null) {
            String[] parts=bbox.split(",");
            if(parts.length!=4)throw new IllegalArgumentException("bbox must have four WGS84 numbers");
            bounds=new double[4];
            try{for(int i=0;i<4;i++)bounds[i]=Double.parseDouble(parts[i].trim());}
            catch(NumberFormatException ex){throw new IllegalArgumentException("bbox must have four WGS84 numbers");}
            if(!Double.isFinite(bounds[0])||!Double.isFinite(bounds[1])||!Double.isFinite(bounds[2])||
                !Double.isFinite(bounds[3])||bounds[0]>=bounds[2]||bounds[1]>=bounds[3]||
                bounds[0]<-180||bounds[2]>180||bounds[1]<-90||bounds[3]>90)
                throw new IllegalArgumentException("Invalid WGS84 bbox");
        }
        List<Map<String,Object>> result=features.list(type,category,bounds,limit,businessOnly);
        return Map.of("type","CampusFeatureCollection","count",result.size(),"features",result);
    }
    @GetMapping("/features/{id}")
    public Map<String,Object> one(@PathVariable String id){
        Map<String,Object> f=features.byId(id);
        if(f==null)throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Feature not found");
        return f;
    }
    @GetMapping("/search")
    public List<Map<String,Object>> search(@RequestParam String q,@RequestParam(defaultValue="40") int limit){
        if(q.isBlank()||q.length()>100||limit<1||limit>100)throw new IllegalArgumentException("Invalid search query or limit");
        return features.search(q,limit);
    }
    @GetMapping("/layers")
    public List<Map<String,Object>> layers(){return features.layers();}
    @GetMapping("/stats/overview")
    public Map<String,Object> stats(){return features.overview();}
}
