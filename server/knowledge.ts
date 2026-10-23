import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./db.js";
import { AIError, type Citation } from "./ai.js";
const injection =
  /ignore\s+(?:all\s+)?(?:previous|prior|above)|system\s*(?:prompt|message)|(?:reveal|exfiltrate|leak)\s+(?:secrets?|credentials?|api\s*keys?)|override\s+(?:instructions|policy)|<\/?(?:system|assistant)>/i;
const embeddingSchema = z.object({
  data: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        embedding: z.array(z.number().finite()).length(1536),
      }),
    )
    .min(1),
});
const model = () =>
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
export function chunkDocument(content: string): string[] {
  if (injection.test(content))
    throw new AIError(
      "invalid_output",
      "Document contains instruction-like content; review and remove it before indexing.",
      422,
    );
  const chunks: string[] = [];
  // Fixed windows with overlap bound parsing cost and preserve short policy context.
  for (let position = 0; position < content.length; position += 750) {
    const excerpt = content.slice(position, position + 900).trim();
    if (excerpt) chunks.push(excerpt);
    if (chunks.length > 150)
      throw new AIError(
        "invalid_output",
        "Document is too large to index.",
        422,
      );
  }
  return chunks;
}
async function ensureVector(db: Database) {
  const available = (
    await db.query("SELECT 1 FROM pg_extension WHERE extname='vector'")
  ).rows.length;
  const table = (
    await db.query("SELECT to_regclass('knowledge_embeddings') AS name")
  ).rows[0]?.name;
  if (!available || !table)
    throw new AIError(
      "configuration",
      "Semantic retrieval needs pgvector and the knowledge_embeddings migration.",
    );
}
async function embed(texts: string[]): Promise<number[][]> {
  if (!process.env.OPENAI_API_KEY)
    throw new AIError(
      "configuration",
      "Embedding provider credentials are missing.",
    );
  let raw: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model(),
          dimensions: 1536,
          input: texts,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) {
        if (
          attempt === 0 &&
          (response.status === 429 || response.status >= 500)
        ) {
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        throw new AIError("unavailable", "Embedding provider is unavailable.");
      }
      raw = await response.json();
      break;
    } catch (error) {
      if (error instanceof AIError) throw error;
      if (attempt === 1)
        throw new AIError("unavailable", "Embedding request failed.");
    }
  }
  const parsed = embeddingSchema.safeParse(raw);
  if (!parsed.success || parsed.data.data.length !== texts.length)
    throw new AIError(
      "invalid_output",
      "Embedding provider returned an invalid response.",
      502,
    );
  const ordered = parsed.data.data.sort((a, b) => a.index - b.index);
  if (
    ordered.some(
      (item, index) =>
        item.index !== index || !item.embedding.some((value) => value !== 0),
    )
  )
    throw new AIError(
      "invalid_output",
      "Embedding provider returned invalid vectors.",
      502,
    );
  return ordered.map((item) => item.embedding);
}
export async function indexDocument(
  db: Database,
  orgId: string,
  document: { id: string; title: string; content: string; version?: number },
): Promise<{ indexedChunks: number; mode: string }> {
  const snapshot = (
    await db.query(
      "SELECT id,title,content,version FROM documents WHERE org_id=$1 AND id=$2",
      [orgId, document.id],
    )
  ).rows[0];
  if (!snapshot)
    throw new AIError("invalid_output", "Document not found.", 404);
  if (
    snapshot.title !== document.title ||
    snapshot.content !== document.content ||
    (document.version !== undefined && snapshot.version !== document.version)
  )
    throw new AIError(
      "invalid_output",
      "Document changed before indexing. Retry.",
      409,
    );
  const excerpts = chunkDocument(snapshot.content);
  if (injection.test(snapshot.title))
    throw new AIError(
      "invalid_output",
      "Document title contains instruction-like content.",
      422,
    );
  const semantic = process.env.EMBEDDING_PROVIDER === "openai";
  if (
    process.env.EMBEDDING_PROVIDER &&
    !["disabled", "openai"].includes(process.env.EMBEDDING_PROVIDER)
  )
    throw new AIError("configuration", "Unknown embedding provider.");
  if (semantic) await ensureVector(db);
  const vectors: number[][] = [];
  // Keep individual provider batches small; costs and availability remain deployment concerns.
  if (semantic)
    for (let start = 0; start < excerpts.length; start += 16)
      vectors.push(...(await embed(excerpts.slice(start, start + 16))));
  await db.transaction(async (tx) => {
    const current = (
      await tx.query(
        "SELECT version,title,content FROM documents WHERE org_id=$1 AND id=$2 FOR UPDATE",
        [orgId, document.id],
      )
    ).rows[0];
    if (
      !current ||
      current.version !== snapshot.version ||
      current.title !== snapshot.title ||
      current.content !== snapshot.content
    )
      throw new AIError(
        "invalid_output",
        "Document changed during indexing. Retry.",
        409,
      );
    await tx.query(
      "DELETE FROM knowledge_chunks WHERE org_id=$1 AND document_id=$2",
      [orgId, document.id],
    );
    for (let i = 0; i < excerpts.length; i++) {
      const chunkId = randomUUID();
      await tx.query(
        "INSERT INTO knowledge_chunks(id,org_id,document_id,document_version,ordinal,title,excerpt) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          chunkId,
          orgId,
          document.id,
          snapshot.version,
          i,
          snapshot.title,
          excerpts[i],
        ],
      );
      if (semantic)
        await tx.query(
          "INSERT INTO knowledge_embeddings(chunk_id,org_id,model,embedding) VALUES($1,$2,$3,$4::vector)",
          [chunkId, orgId, model(), JSON.stringify(vectors[i])],
        );
    }
  });
  return {
    indexedChunks: excerpts.length,
    mode: semantic ? "openai-pgvector" : "postgres-full-text",
  };
}
export async function retrieveDocuments(
  db: Database,
  orgId: string,
  query: string,
): Promise<Citation[]> {
  const semantic = process.env.EMBEDDING_PROVIDER === "openai";
  if (semantic) {
    await ensureVector(db);
    const vector = (await embed([query.slice(0, 12000)]))[0]!;
    const rows = (
      await db.query(
        `SELECT c.document_id AS id,c.title,c.excerpt FROM knowledge_embeddings e JOIN knowledge_chunks c ON c.id=e.chunk_id AND c.org_id=e.org_id JOIN documents d ON d.id=c.document_id AND d.org_id=c.org_id AND d.version=c.document_version WHERE e.org_id=$1 AND c.org_id=$1 AND d.org_id=$1 AND e.model=$2 AND (e.embedding <=> $3::vector)<0.65 ORDER BY e.embedding <=> $3::vector LIMIT 3`,
        [orgId, model(), JSON.stringify(vector)],
      )
    ).rows;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      excerpt: row.excerpt,
    }));
  }
  const terms = (query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
    .slice(0, 32)
    .join(" | ");
  if (!terms) return [];
  const rows = (
    await db.query(
      `SELECT c.document_id AS id,c.title,c.excerpt FROM knowledge_chunks c JOIN documents d ON d.id=c.document_id AND d.org_id=c.org_id AND d.version=c.document_version WHERE c.org_id=$1 AND d.org_id=$1 AND to_tsvector('english',c.title || ' ' || c.excerpt) @@ to_tsquery('english',$2) ORDER BY ts_rank(to_tsvector('english',c.title || ' ' || c.excerpt),to_tsquery('english',$2)) DESC LIMIT 3`,
      [orgId, terms],
    )
  ).rows;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
  }));
}
