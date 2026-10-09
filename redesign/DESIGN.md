# Kunchas POS workspace redesign

User direction: retain original live colours; make the POS layout visibly new while retaining complete functional parity. Supersedes earlier border-only and white-heavy proposals.

## Presentation

Original dark plum navigation remains unchanged. Three bounded work areas replace the long single form panel: Customer, Items, Payment. Each retains its original controls and sequence; in-page links help move between areas. Search results use a two-column card treatment on wide screens, retaining the original picker buttons and keyboard handlers. The sale summary occupies a distinct plum-tinted column and remains visible beside the work areas on sufficiently wide screens. At 900px and below it returns to normal document flow; narrow-screen search results use one column.

Retain original tokens: ink #1c1724, muted #716b79, line #e7e1ea, canvas #f8f6f9, brand #5b1b6f, dark brand #3b1048, brand soft #f3eaf6, surface white. Existing Roboto/system stack. No remote assets, new fonts or dependencies. Section headings 21–23px, monetary totals 28–32px, input text 16px, control labels 14px. Existing errors, selected states and payment colours remain. Focus outlines use original brand. Reduced motion respected.

Use the already reviewed awesome-claude-design, web-design and ui-ux-pro-max principles: clear hierarchy, stable task order, contrast, keyboard access and responsive content. The comparison image could not be materialized as local pixels, so this does not claim a pixel match.

## Implementation and verification

Five reversible presentation-only POS markup substitutions plus one #pos-scoped CSS insertion. No JavaScript or business rules change. All original static control tags/attributes/order retained except form styling class. Booking original unchanged. See POS-FUNCTIONAL-PARITY.md for the complete mapping and pending runtime checks.

preview.html is a static visual fixture from original markup. It uses no customer data, invented catalogue/prices, network requests or transaction handlers. Existing blank item picker is expanded for illustration. Review is required before publication; no live changes authorized by this draft alone.
