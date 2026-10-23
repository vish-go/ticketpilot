# API contract

All responses are JSON. Validation errors return `{error,fields?}`. Successful record creation normally returns HTTP 201; successful mutations return a record or `{ok:true}`. UUIDs identify resources. The server's Zod schemas are authoritative for exact limits.

After registration/login, retain the `tp_session` HttpOnly cookie and read `{user,organizations,csrfToken}`. Send `X-CSRF-Token` on authenticated mutations. Tenant routes also need `X-Organization-Id` containing an organization from the signed-in user's memberships. Production clients use the same origin as the API. No browser bearer token is required.

## Authentication and workspaces

| Method and route | Request | Response / access |
| --- | --- | --- |
| POST `/api/auth/register` | `{name,email,password,organization}` | Identity and new owner workspace |
| POST `/api/auth/login` | `{email,password}` | Identity and session cookie |
| GET `/api/auth/me` | — | `{user,organizations,csrfToken}` |
| POST `/api/auth/logout` | `{}` | Revokes current session |
| POST `/api/auth/forgot-password` | `{email}` | Generic acknowledgement; configured mail required |
| POST `/api/auth/reset-password` | `{token,password}` | Revokes existing sessions after reset |
| POST `/api/organizations` | `{name}` | New workspace, current user becomes owner |
| POST `/api/invitations/accept` | `{token}` | Signed-in email must match invite |
| GET `/api/members` | — | Staff-visible member array |
| PATCH `/api/members/:id` | `{role}` | Owner/admin with hierarchy protection |
| DELETE `/api/members/:id` | — | Owner/admin; unassigns tickets; cannot remove self/owner |
| DELETE `/api/invitations/:id` | — | Owner/admin; revokes unaccepted invitation |
| GET `/api/invitations` | — | Owner/admin invitation metadata |
| POST `/api/invitations` | `{email,role}` | Owner/admin; returns one-time token to share securely |
| GET `/api/settings` | — | Staff-visible workspace configuration |
| PATCH `/api/settings` | `{name,response_minutes,resolution_minutes,guidelines?}` | Owner/admin |
| GET `/api/audit` | — | Owner/admin; latest 100 administrative events |

Passwords must satisfy the current server schema. Roles are `owner`, `admin`, `agent`, and `customer`; invitation creation accepts the latter three. Invitations expire and are single use. Owners cannot be demoted or removed through these routes. Administrators cannot manage other administrators; changing a staff member to customer clears their assignments. A token is sensitive and should not be pasted into logs or public issues.

## Tickets and conversation

| Method and route | Request | Response / access |
| --- | --- | --- |
| GET `/api/tickets` | Query `q,status,priority,page,sort` | `{items,total,page,pageSize}`; 20 per page |
| POST `/api/tickets` | `{subject,body,customerEmail,priority?,category?}` | Stored ticket |
| GET `/api/tickets/:id` | — | `{ticket,messages,activities,drafts}` |
| PATCH `/api/tickets/:id` | `{version,status?,priority?,category?,assigneeId?,subject?}` | Staff; returns incremented version |
| POST `/api/tickets/:id/messages` | `{body,internal?,version,draftId?}` | Stored reply/note; optional reviewed draft |
| DELETE `/api/tickets/:id` | — | Owner/admin; permanent deletion with audit |

Status values: `open`, `in_progress`, `pending`, `resolved`, `closed`. Priority values: `low`, `normal`, `high`, `urgent`. Categories: `billing`, `refund`, `delivery`, `product_complaint`, `technical_issue`, `general_inquiry`. Sort is `newest` or `oldest`. An assignee must be a staff member of the same workspace; use `null` to unassign.

Version conflicts return HTTP 409. Reload the current record and let the user intentionally retry. Resolved/closed tickets must be reopened before adding conversation messages. Customers see only their own created tickets and public messages; internal notes, staff activities, and drafts are excluded. Staff may see all workspace tickets.

A stored public response creates a durable outbound job. This does not prove external delivery. The worker and configured email provider determine delivery status.

## Knowledge, AI, and analytics

| Method and route | Request | Response / access |
| --- | --- | --- |
| GET `/api/documents` | — | Staff-visible organization document array |
| POST `/api/documents` | `{title,content}` | Owner/admin; text document |
| PATCH `/api/documents/:id` | `{title,content}` | Owner/admin; increments document version |
| POST `/api/documents/:id/reindex` | `{}` | Owner/admin; retry current document indexing |
| DELETE `/api/documents/:id` | — | Owner/admin; removes current document |
| POST `/api/tickets/:id/ai` | `{}` | Staff; `{draft,classification}` |
| POST `/api/drafts/:id/reject` | `{}` | Staff; rejects pending draft |
| GET `/api/analytics` | — | Staff; ticket metrics, categories, workload |

Document content is bounded to 200,000 characters within a 256 KiB JSON body limit. This is text intake, not a general binary upload endpoint. Saves return indexing state; a stored document can have failed indexing and be retried separately. Only chunks matching the current document version are eligible for retrieval. Draft citations contain document ID, title, and excerpt. A generated category/priority is a suggestion; it does not silently replace human labels. Approve a draft by sending an editable public message with `draftId` and the current ticket `version`. Stale or already reviewed drafts return a conflict.

## Inbound gateway

POST `/api/webhooks/inbound` is authenticated independently of browser sessions. The trusted gateway sends `{eventId,organizationId,ticketId?,from,subject,text}`. A new event creates a ticket; `ticketId` appends to the matching organization's conversation only when the sender matches its customer email. Repeated event IDs are ignored transactionally.

Headers: `X-Timestamp` is Unix seconds and `X-Signature` is the HMAC-SHA256 hex digest (optional `sha256=` prefix). Sign the exact bytes of `timestamp + "." + rawRequestBody` using `INBOUND_WEBHOOK_SECRET`. Timestamps outside five minutes are rejected. The shared gateway secret is powerful: the gateway is responsible for routing mail to the correct organization and must not expose arbitrary tenant selection to untrusted senders. This custom protocol needs an adapter for an external provider's native webhook format.

## Operations

GET `/api/health` reports process liveness. GET `/api/ready` performs a database query. Both are unauthenticated and return no customer data. Rate limits apply to API, authentication, and AI requests. A response `X-Request-Id` supports safe log correlation.
