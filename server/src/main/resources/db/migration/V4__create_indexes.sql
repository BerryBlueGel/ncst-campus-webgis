CREATE INDEX campus_feature_geometry_gix ON campus_feature USING gist(geometry);
CREATE INDEX campus_feature_centroid_gix ON campus_feature USING gist(centroid);
CREATE INDEX campus_feature_source_idx ON campus_feature(source_layer);
CREATE INDEX campus_feature_category_idx ON campus_feature(category);
