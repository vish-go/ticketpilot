# 5. Who are you, and what may you do?

Authentication identifies the signed-in user. Authorization decides which actions that user may perform in a particular workspace. An agent in workspace A is not automatically an agent in workspace B. The server verifies memberships and roles for each protected request.

Passwords are hashed with bcrypt rather than encrypted for later recovery. A session uses an unpredictable secret in an HttpOnly cookie; its hash is stored server-side. HttpOnly makes it inaccessible to normal browser JavaScript. HTTPS and Secure cookies protect transmission. CSRF tokens help prevent another website from submitting actions using your cookies.

Never log passwords, session tokens, invitation tokens, provider keys, or customer text. Environment files are local configuration, not source. Knowledge documents are also untrusted input; a paragraph saying "ignore previous instructions" has no authority over the application.

Exercise: sign in as two users in different workspaces. Attempt to fetch the other workspace's ticket by ID. The server must deny it even when you know the URL. Review the negative tests for this behavior.
