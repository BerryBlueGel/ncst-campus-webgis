package edu.ncst.campus;

import edu.ncst.campus.importer.CampusImporter;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class CampusWebGisApplication {
    public static void main(String[] args) {
        SpringApplication.run(CampusWebGisApplication.class, args);
    }

    @Bean
    ApplicationRunner importRunner(CampusImporter importer,
            @Value("${campus.import-on-start:false}") boolean enabled) {
        return args -> { if (enabled) importer.importAll(); };
    }
}
