-- Enable pg_trgm for full-text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Row Level Security will be configured per table after migrations