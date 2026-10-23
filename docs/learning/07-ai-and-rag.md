# 7. Evidence before a draft

Retrieval-augmented generation first selects relevant policy passages, then asks a model to answer using them. Authorization happens before retrieval: only the current workspace's documents enter the AI module. Documents are split into bounded chunks and stored with their version. Default retrieval uses PostgreSQL full-text search. Optional OpenAI embeddings and pgvector support semantic search; this needs credentials and a vector-capable database. A citation points back to a selected document, letting a human check the claim.

The local provider is a deterministic extractive baseline, not a trained language model. It is useful for predictable testing and returns evidence or abstains. An external provider is opt-in and may receive customer data. Structured output validation checks shape and allowed citation IDs; it cannot prove every sentence is true.

A draft is separate from a sent message. The agent must review, edit, or reject it. Untrusted documents cannot grant tool access or permission to send. Prompt-injection defenses reduce risk but need adversarial tests and human review.

Exercise: upload a short refund policy and ask a relevant and an unrelated question. Inspect both citation behavior and abstention. Add a misleading instruction to a test document and confirm it cannot trigger an action. Run the versioned evaluations and distinguish their small regression scores from production quality.
