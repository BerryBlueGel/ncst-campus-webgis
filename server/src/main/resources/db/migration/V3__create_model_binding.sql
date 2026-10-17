CREATE TABLE model_binding (
    feature_id varchar(160) PRIMARY KEY REFERENCES campus_feature(id) ON DELETE CASCADE,
    asset varchar(255) NOT NULL,
    node_name varchar(255) NOT NULL,
    model_group varchar(120) NOT NULL,
    refined boolean NOT NULL DEFAULT true
);
