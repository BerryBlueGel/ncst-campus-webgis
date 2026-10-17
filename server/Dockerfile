FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY server/pom.xml server/pom.xml
COPY server/src server/src
RUN mvn -q -f server/pom.xml -DskipTests package

FROM eclipse-temurin:21-jre-jammy
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 campus \
    && useradd --system --uid 10001 --gid 10001 --home-dir /app campus
WORKDIR /app
COPY --from=build --chown=10001:10001 /build/server/target/campus-webgis-server-0.1.0.jar /app/server.jar
COPY --chown=10001:10001 output/geojson /app/data/output/geojson
COPY --chown=10001:10001 output/debug/campus_boundary_local.geojson /app/data/output/debug/campus_boundary_local.geojson
COPY --chown=10001:10001 reference/stadiums/stadium_inventory.json /app/data/reference/stadiums/stadium_inventory.json
COPY --chown=10001:10001 reference/stadiums/stadium_measurements.geojson /app/data/reference/stadiums/stadium_measurements.geojson
COPY --chown=10001:10001 web/public/data /app/data/web/public/data
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app/server.jar"]
