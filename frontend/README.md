# Client Reports frontend

React + TypeScript + Vite. Like-for-like rebuild of `prototype/` on mock data.

```
npm install
npm run dev        # http://localhost:5173
npm test           # mock engine parity tests
npm run build      # typecheck + production build
```

- `src/lib/catalog.ts`: reads `../catalog/catalog.json`; hides the client key and restricted columns
- `src/lib/mockEngine.ts`: MOCK evaluation in the browser; to be replaced by the preview API
- `src/lib/graph.ts`, `useApp.ts`: flow model, layout, status, app state and actions
- `src/components/`, `src/pages/`: canvas, step panel, palette, pages
