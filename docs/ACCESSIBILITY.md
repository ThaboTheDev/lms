# Accessibility

Target: WCAG 2.2 AA. The public statement at `/accessibility` says the same
thing in the words a learner would use.

## What the build does

| Area | How |
| --- | --- |
| Keyboard | Every control reachable and operable; visible focus outline set globally on `:focus-visible` |
| Bypass blocks | Skip link to `#main` on every authenticated page |
| Forms | Real `<label>` for every field; hints and errors wired with `aria-describedby`; errors announced with `role="alert"` |
| Status messages | Action results use `role="status"` or `role="alert"` so a screen reader hears them without a focus change |
| Tables | `<caption>`, `<th scope>` and row headers, so a screen reader can read across a row of results |
| Colour | Never the only signal: state tags carry text, not just a colour |
| Contrast | Body text, controls and the navigation rail meet 4.5:1 in both colour schemes; the active nav marker meets 3:1. The rail keeps its own tokens (`--rail*`) because `--ink` is the text colour and inverts |
| Motion | Limited by default, and `prefers-reduced-motion` disables what remains |
| High contrast | Structural borders repainted under `forced-colors: active` |
| Touch | 44px minimum targets under `pointer: coarse`, including in dense tables |
| Zoom and reflow | Relative units throughout; content reflows to a phone with no sideways scroll |
| Language | `lang="en-ZA"` on the document; interface text is centralised for translation |
| Timing | The examination timer warns before it expires and submits the work rather than discarding it |

## Known gaps

- Wide administrative tables scroll horizontally on a small screen. Readable,
  not comfortable, and honestly stated in the public statement.
- Uploaded teaching material is only as accessible as the file a lecturer
  uploaded. The platform cannot fix a scanned PDF.
- Video captions depend on the uploader.

## Testing this properly

Automated checks catch perhaps a third of what matters. Before the first intake:

1. Run axe or Lighthouse over the ten screens learners use most.
2. Walk the learner journey with the keyboard only: sign in, open a course,
   read a lesson, sit a quiz, submit an assignment, read a result.
3. Walk the same journey with a screen reader. NVDA on Windows and VoiceOver on
   iOS are what South African learners are most likely to have.
4. Ask a learner who actually uses assistive technology. Nothing above
   substitutes for that.
