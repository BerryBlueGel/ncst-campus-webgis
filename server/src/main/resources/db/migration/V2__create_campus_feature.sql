CREATE TABLE campus_feature (
    id varchar(160) PRIMARY KEY,
    name varchar(255) NOT NULL,
    feature_type varchar(80) NOT NULL,
    category varchar(80),
    geometry geometry(Geometry,32650) NOT NULL,
    centroid geometry(Point,32650),
    description text,
    aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
    properties jsonb NOT NULL DEFAULT '{}'::jsonb,
    refined boolean NOT NULL DEFAULT false,
    source_layer varchar(80) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT campus_feature_valid CHECK (ST_IsValid(geometry) AND NOT ST_IsEmpty(geometry))
);
