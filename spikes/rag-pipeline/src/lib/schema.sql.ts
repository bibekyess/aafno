// PGlite + pgvector DDL (FR-5, spec "Data / Migration Notes"). Fresh DB, no migration — this is
// the first schema. `embed_dim` records R2's confirmed dimension (768) for the embedding model
// named in `embed_model`; `char_start`/`char_end` on `chunks` give source attribution (FR-5, AC-1).

export const EMBEDDING_DIM = 768;

export const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  source_kind  TEXT NOT NULL,          -- 'bundled' | 'uploaded'
  byte_size    INTEGER,
  char_length  INTEGER NOT NULL,
  parsed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  embed_model  TEXT NOT NULL,          -- 'onnx-community/embeddinggemma-300m-ONNX'
  embed_dim    INTEGER NOT NULL        -- 768 (records R2's confirmed dimension)
);

CREATE TABLE IF NOT EXISTS chunks (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal      INTEGER NOT NULL,       -- chunk order within the document
  text         TEXT NOT NULL,
  token_count  INTEGER NOT NULL,
  char_start   INTEGER NOT NULL,       -- offset into parsed text (source attribution, FR-5)
  char_end     INTEGER NOT NULL,
  embedding    vector(${EMBEDDING_DIM}) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS chunks_doc_ordinal ON chunks (document_id, ordinal);
`;

export const HNSW_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
`;

export const RETRIEVE_SQL = `
SELECT id, document_id, ordinal, text, char_start, char_end, 1 - (embedding <=> $1) AS similarity
FROM chunks
ORDER BY embedding <=> $1
LIMIT $2;
`;
