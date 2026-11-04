# Workflow canvas

This replaces the card-grid interface at `/workforce-map/index.html` with a connected SVG canvas. It keeps the original 32-item catalogue and state contract intact. `graphs.mjs` adds authored, flow-specific design detail; these graphs are not automatically extracted from deployed Trigger or Skyvern workflows.

## Open

```sh
node private-runtime/workflows/preview.mjs
# http://127.0.0.1:4310
```

Or open `/workforce-map/index.html` in authenticated Bops. A portable HTML file needs no server or CDN:

```sh
node private-runtime/workflows/export-map.mjs /absolute/path/workflow-canvas.html
```

## Controls

Choose a workflow in the sidebar. Drag the background to pan; scroll or use +/− to zoom. F fits the diagram. Drag a node to rearrange it for inspection. Those positions last only in the current page session and do not modify source or executable workflows.

Click a node for its responsible component, underlying catalogue contract, evidence, recovery rule and outgoing connections. Decision diamonds have labelled outcomes. Red dashed edges represent failure/blocked routes; purple dashed edges represent recovery. The Exceptions checkbox hides exception routes. Trace a route highlights one illustrative path; Next step moves along that design path without running anything.

System map shows Bops, Trigger, action controls and the browser/API/computer branches. Double-click an associated component to open its workflow. Export SVG saves the current graph as a scalable diagram. Scope & source distinguishes the original catalogue from added design detail and retains the explicit read-only Bops status check.

## Verification boundary

Graph tests check all 32 diagrams, valid references, reachable nodes, distinct concrete step sequences, illustrative path continuity and no direct uncertain-send replay. Browser acceptance covers selection, connectors, node inspection, route highlighting, zoom, dragging, exception visibility, SVG export, system drill-down, mobile layout and portable HTML. Tests of this view do not establish live backend deployment or business integration readiness.

The renderer needs no third-party CDN or model API. Existing backend adapters, authorization, action receipts and original catalogue/state semantics are unchanged. This is a visual design tool, not a live workflow editor or production execution dashboard.
