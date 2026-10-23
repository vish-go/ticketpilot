# 1. What TicketPilot does

TicketPilot is a shared support inbox for businesses. An organization is a workspace; a membership connects a person to it with a role. A ticket stores a customer's problem. Messages record conversation, while activities record changes such as assignment and resolution. Knowledge documents supply policy evidence for optional AI drafts.

The browser displays data. The API decides whether a user may read or change it. PostgreSQL preserves it when you close the browser. The worker performs scheduled work. AI is optional: a support agent can always write a reply manually.

## Follow one ticket

1. Register an account and workspace. Your password is hashed; a session cookie keeps you signed in.
2. Fill the React ticket form. The client sends JSON, the selected workspace ID, and a CSRF token to Express.
3. Express validates the fields and your membership. It inserts a ticket and its creation activity in a transaction.
4. PostgreSQL commits. The browser refreshes its list from the API; it does not invent a row locally.
5. Open the ticket and assign a workspace member. A version number prevents a stale screen from silently overwriting a colleague's edit.
6. Add a reply or internal note. A public response affects first-response tracking; a note remains private to the team.
7. If configured, request an AI draft. Read its citations and edit it before sending.
8. Resolve the ticket. The history and analytics reflect stored changes.

Exercise: create two workspaces and one ticket in each. Switch between them and explain why the API must enforce the same separation as the interface.
