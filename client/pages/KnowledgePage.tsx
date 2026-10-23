import { Badge, Empty } from "../components/ui";
import { date } from "../lib/presentation";
import type { Api, Doc, Run } from "../types";

type Props = {
  loading: boolean;
  documents: Doc[];
  admin: boolean;
  busy: boolean;
  api: Api;
  run: Run;
  setNotice: (message: string) => void;
  loadPage: () => Promise<void>;
  setEditingDoc: (document: Doc) => void;
  setShowDocForm: (show: boolean) => void;
};
export function KnowledgePage({
  loading,
  documents,
  admin,
  busy,
  api,
  run,
  setNotice,
  loadPage,
  setEditingDoc,
  setShowDocForm,
}: Props) {
  return (
    <>
      <div className="info-banner">
        <span>▧</span>
        <p>
          <strong>Keep your answers grounded.</strong> Add plain text or
          Markdown policies. AI can cite matching passages, and an agent reviews
          the final response.
        </p>
      </div>
      {loading ? (
        <p role="status">Loading documents…</p>
      ) : (
        <div className="document-grid">
          {documents.map((d) => (
            <article className="panel document-card" key={d.id}>
              <span className="document-icon">▤</span>
              <h3>{d.title}</h3>
              <p>{d.content?.slice(0, 200) || "Workspace document"}</p>
              <div className="index-state">
                <Badge value={d.index_status || "pending"} />
                {d.index_error && (
                  <p className="small danger-text">{d.index_error}</p>
                )}
                {admin && d.index_status !== "indexed" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await api(
                          `/documents/${d.id}/reindex`,
                          "POST",
                          {},
                        );
                        setNotice(
                          result.status === "indexed"
                            ? "Document indexed and ready for retrieval."
                            : `Document saved, indexing failed: ${result.message || "Please check provider configuration and retry."}`,
                        );
                        await loadPage();
                      })
                    }
                  >
                    Retry indexing
                  </button>
                )}
              </div>
              <div className="document-footer">
                <span>{date(d.created_at)}</span>
                {admin && (
                  <div>
                    <button
                      onClick={() => {
                        setEditingDoc(d);
                        setShowDocForm(true);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="danger-text"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Delete this document and its retrieval passages?",
                          )
                        )
                          run(async () => {
                            await api(`/documents/${d.id}`, "DELETE");
                            await loadPage();
                          });
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
          {!documents.length && (
            <section className="panel">
              <Empty title="Your knowledge belongs here">
                Add a support policy to make answers easier to find.
              </Empty>
            </section>
          )}
        </div>
      )}
    </>
  );
}
