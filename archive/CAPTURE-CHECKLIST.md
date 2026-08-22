# Old WebReg capture checklist — DO BEFORE DECOMMISSION

WebReg dies with the TSS cutover (Summer 2026). These need YOUR SSO login; can't be
automated. ~20 minutes total. Log in at https://act.ucsd.edu/webreg2/ and:

## 1. HAR export (most valuable — exact markup/CSS/JS + API responses)
1. Open DevTools → Network tab → check "Preserve log"
2. Hard-reload WebReg, then do a full session: pick term → search a course →
   expand sections → plan a class → open calendar tab → finals tab → remove class
3. Network tab → right-click → "Save all as HAR with content"
4. Save as `archive/capture/webreg-session.har`

## 2. Full page saves
For each main screen: File → Save Page As → "Webpage, Complete"
into `archive/capture/pages/`:
- term select, main list view, calendar view, finals view, search results expanded

## 3. Screenshots (`archive/capture/screenshots/`, full-window PNG)
- [ ] term select
- [ ] main screen w/ enrolled + waitlisted + planned rows (status column variety)
- [ ] search autocomplete open
- [ ] advanced search panel
- [ ] expanded course w/ real seat counts + FULL Waitlist(N) row
- [ ] confirm dialog (grading/units)
- [ ] success modal
- [ ] drop warning dialog
- [ ] calendar view w/ a conflict (red outline)
- [ ] finals tab
- [ ] appointment-time popup
- [ ] any error dialog you can trigger (prereq not met, time not open)

## 4. Tutorial video
Download https://www.youtube.com/watch?v=_wM4QDEejdc (shows UI in motion)
→ `archive/capture/webreg-tutorial.mp4`

Note: personal data (PID, name, courses) will appear in captures — keep
`archive/capture/` out of the public repo. It's gitignored.
