# Dashboard components and responsive layout

The app remains Django templates plus native ES modules: no production Node build or client framework is required. `components.js` provides DOM constructors for route badges/text, library icons, save controls, equipment reports and two-item alert previews. Continue using `textContent` and DOM text nodes for all feed content; never interpolate it into HTML.

Route names, colors and express shapes have one definition in this module. Use `bullet(route, size)` for every route marker and `routeText(text)` for bracketed MTA route tokens in descriptions. Express IDs 6X and 7X use base-route colors and diamonds. Shuttle accessible labels retain the specific service name.

Icons are unchanged individual SVGs from lucide-static 0.468.0, under `static/myapp/vendor/lucide`, with license and source. `icon(name)` uses locally served SVG masks, follows text color and hides decorative icons from assistive technology. Equipment uses directional icons accompanied by explicit Elevator/Escalator text, not an ambiguous unlabeled symbol. Label the owning button, not the icon.

`alertPreview` shows two items and stores expansion by entity/section in memory. Refreshes preserve that state; reloading the page resets it. Save controls expose pending and pressed state. Equipment reports render only supplied fields, and never imply that unreported devices are operational.

Layout uses the existing CSS tokens for colors, surfaces and typography. At 1024px, the page changes to overview/line grid on the left and details on the right. At 1440px the line page uses a 55/45 split with a 1680px maximum. The station page gives details more space (35/65 from 1200px), since search controls need less room than station information. Alert columns split only when the details content area is at least 620px wide. Tablets (768–1023px) use full-width details with paired summary/accessibility and alert columns. Phones use source-order vertical flow with details before the line grid. DOM order matches mobile reading and keyboard order. `/lines/` contains the service overview and saved lines; `/stations/` contains station search and saved stations. The root URL remains the line dashboard for compatibility. Station route badges link to `/lines/?route=N` (or the selected route). Navigation identifies the current page. Both pages share the template and components while restricting visible sections and catalog loading by page mode. All details use page scrolling.

## Tests

```sh
npm ci
npm test
python manage.py test myapp
```

Node dependencies are development-only: LinkeDOM supplies a DOM for component behavior tests. Deployment does not require npm install. Test disclosure state after rerender, safe route-text rendering, equipment fields and save-control states. Station/favorites tests also cover account changes and API isolation. The dashboard DOM integration test verifies separate page behavior, route links, disclosure refresh state, equipment reports and failure messages.

Check widths 320, 390, 768, 1024, 1440 and 1920px plus phone landscape; include long names, empty/error states, dark/light mode, keyboard interaction, reduced motion and zoom. Real Google sign-in must use an authorized hostname, such as localhost.

Feed text also recognizes `[shuttle bus icon]` and `[accessibility icon]` (case-insensitive, normalized whitespace), using local Lucide icons with readable labels. Unknown tokens remain literal. Published station accessibility is translated to plain step-free-access language; equipment types and directional notes are shown only when provided. Search controls use a two-column grid that stacks at 560px, with a 12px gap and no fixed field heights. Refresh sits below the timestamp on both pages.
