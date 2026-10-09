# POS appearance revision

Supersedes the rejected white-sidebar and alternate-palette designs. Keep original live colours and original layout. Refine only POS typography, component padding, border radii, card borders, subtle elevation, number alignment and visible focus.

All candidate selectors are scoped to #pos. No sidebar, navigation, booking, closing or dashboard styling changes. No display, position, order, grid, flex, visibility, pointer-event, overflow or z-index declarations. No font or asset dependency is introduced. The original :root colours remain byte-identical.

The candidate differs from original c905c92 only by one inline CSS insertion within renderApp. Removing that insertion must reproduce the complete original main bundle byte-for-byte. Booking bundle is restored to the exact original. No DOM, script, handlers, permissions, calculations or unfinished float functionality change.

preview.html uses the original POS section and baseline CSS, with the scoped refinement. Preview-only state makes the existing workspace visible; the original payment panel remains hidden. Scripts are omitted, network access and form submission blocked by CSP. No invented sample catalogue, prices, controls or services. It is a static visual fixture, not a functional test.

Validation: source equivalence and JavaScript syntax passed. Visual rendering remains pending because local execution cannot start and the browser forbids file URLs. Concept image materialization returned no local pixels; no visual-match claim. Publication remains paused until revised appearance is reviewed.
