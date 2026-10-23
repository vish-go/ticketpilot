import { Field } from "./ui";

export function WorkspaceForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (name: string) => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCreate(String(new FormData(e.currentTarget).get("name")));
      }}
    >
      <Field title="Workspace name">
        <input name="name" required minLength={2} maxLength={100} />
      </Field>
      <button className="primary" disabled={busy}>
        Create workspace
      </button>
    </form>
  );
}
