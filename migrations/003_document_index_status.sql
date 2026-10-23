ALTER TABLE documents ADD COLUMN index_status text NOT NULL DEFAULT 'pending' CHECK(index_status IN ('pending','indexed','failed'));
ALTER TABLE documents ADD COLUMN index_error text;
