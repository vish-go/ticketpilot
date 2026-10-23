# 3. The API

Express routes translate HTTP requests into application operations. Middleware handles request IDs, security headers, body limits, sessions, and tenant authorization. Route handlers validate input, call parameterized SQL, and return JSON. Read `server/` to locate these boundaries rather than adding unrelated behavior to a single handler.

GET reads a resource, POST creates or triggers an action, PATCH changes selected fields, and DELETE removes a resource. HTTP 401 means sign-in is required; 403 means the user lacks permission; 404 avoids revealing absent or inaccessible records; 409 means an update conflicts with a newer version. Validation failures should describe a safe correction without exposing internal details.

A transaction groups writes so either all succeed or none do. Creating a ticket without its activity would leave an inconsistent history, so both belong in one transaction. Do not interpolate a search string into SQL; pass it as a parameter.

Exercise: find the create-ticket handler. List each validation and every inserted row. Add a new bounded field only after updating the schema, validation, response, UI, and tests together.
