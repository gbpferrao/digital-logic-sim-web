# Local JSON storage

`npm run dev` starts the dependency-free API that creates these directories when needed. The repository also keeps a few example projects here so they can be imported directly from the editor.

- `projects/*.json` stores complete projects, including their custom chips.
- `chips/*.json` stores individual custom-chip records written during the same save operation.

Project records use `digital-logic-sim-web/1`. Chip records use `digital-logic-sim-web/chip/1` and contain a `description` object. The browser-only runtime fields `_revision` and `_simSnapshot` are removed before a project is saved or exported.

The local API is served at `http://127.0.0.1:5174` by default:

- `GET /api/health` checks that JSON storage is available.
- `GET /api/projects` and `GET /api/projects/latest` list or load saved projects.
- `GET /api/projects/:id` loads one project; `PUT` or `POST` saves it.
- `GET /api/chips` lists chip records; `GET /api/chips/:id` loads one; `PUT` or `POST` saves one.

The Vite dev server proxies `/api` to that port. Change it with `DLS_API_PORT`; change the web port with `DLS_WEB_PORT` when using `npm run dev`.

The browser keeps a local cache so the UI can render immediately. Server persistence happens asynchronously without a page reload; if the API is unavailable, Save still updates the browser cache and reports that fallback in the UI.
