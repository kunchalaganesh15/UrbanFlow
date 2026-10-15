# UrbanFlow — Corrected Project Notes

This release contains the corrected UrbanFlow prototype.

## Corrections made

- Restored `src/routeTree.gen.ts`, which was referenced by the router and frontend routing test but missing from the project archive.
- Added `pytest` to `backend/requirements.txt` because the repository includes backend tests and documents running them.
- Fixed `/api/model/info` so it reports the full class set supported by the engine, including optional emergency classes.
- Initialized the configured all-red interval when an analysis session starts so the first signal transition does not jump directly to green.
- Added `.env.example` documenting the optional frontend/backend URL configuration.

## Validation

- `backend/app.py` and `backend/engine.py` pass Python compilation.
- The project source and test files are included.
- `node_modules`, Python bytecode caches, and other transient local dependencies are excluded from the release archive.

## Run

See `README.md` for the complete Windows + VS Code setup and operation instructions.
