-- Lexical ingestion works without pgvector. Semantic mode requires pgvector.
ALTER TABLE documents ADD CONSTRAINT documents_id_org_unique UNIQUE(id,org_id);
CREATE TABLE knowledge_chunks (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  document_id uuid NOT NULL,
  document_version integer NOT NULL,
  ordinal integer NOT NULL,
  title text NOT NULL,
  excerpt text NOT NULL,
  FOREIGN KEY(document_id,org_id) REFERENCES documents(id,org_id) ON DELETE CASCADE,
  UNIQUE(id,org_id),
  UNIQUE(document_id,ordinal)
);
CREATE INDEX knowledge_chunks_tenant_document ON knowledge_chunks(org_id,document_id,document_version);
CREATE INDEX knowledge_chunks_search ON knowledge_chunks USING gin(to_tsvector('english',title || ' ' || excerpt));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='vector') THEN
   CREATE EXTENSION IF NOT EXISTS vector;
   EXECUTE 'CREATE TABLE knowledge_embeddings (
     chunk_id uuid PRIMARY KEY,
     org_id uuid NOT NULL,
     model text NOT NULL,
     embedding vector(1536) NOT NULL,
     FOREIGN KEY(chunk_id,org_id) REFERENCES knowledge_chunks(id,org_id) ON DELETE CASCADE
   )';
   EXECUTE 'CREATE INDEX knowledge_embeddings_tenant ON knowledge_embeddings(org_id)';
 END IF;
END $$;
