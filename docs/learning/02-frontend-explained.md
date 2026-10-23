# 2. The React interface

Start in `client/App.tsx`. React components turn current state into screens: authentication, ticket list, conversation, knowledge, team, analytics, and settings. State includes the active workspace, loaded data, selected ticket, and form values. An API helper centralizes cookie and CSRF handling.

A loading state means the network request has not finished. An empty state means it succeeded with no records. An error state means the action failed. Keeping these separate helps a user understand what happened. Labels, visible focus, readable contrast, and keyboard-accessible controls make the app usable beyond a mouse.

Changing a filter triggers another server request; pagination avoids downloading every ticket. After a successful mutation, reload the authoritative record and version. Never treat hidden buttons as permission checks.

Exercise: add a reset-filters button. Confirm it resets search and status, returns to page one, and still displays a useful empty state. Then try the app using only Tab, Enter, and Escape.
