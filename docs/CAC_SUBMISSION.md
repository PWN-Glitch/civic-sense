# CAC submission package

Everything the Congressional App Challenge form and judges need: the written
description, a shot-by-shot video script that matches the shipped build, and
the claims we are prepared to defend.

**Demo platform:** Android (`com.civicsense.app`), with a test build signed
using a debug key. **Demo city:** Baltimore, MD.

---

## 1. One-line pitch

Civic Sense turns a photo of a broken street into a report the right city
office can actually use — and then tells you the truth about what happened to
it.

## 2. Description (form copy, ~250 words)

> When something in your neighborhood breaks — a pothole, a dead streetlight,
> an overflowing bin — most people notice it and do nothing. Not because they
> don't care, but because reporting it is a scavenger hunt: which department,
> which form, which number, and then silence.
>
> Civic Sense removes that friction. Point your camera at the problem. An
> on-device classifier names it and states how sure it is, in plain words —
> "78% sure this is a pothole" — and you confirm or correct it, because
> the person standing there is the authority, not the model. The app pins the
> spot, finds the office responsible for that category in that city, and ranks
> the official channels that can receive it, showing why each one was chosen
> and where the contact came from. It then drafts an editable report, marks the
> category as reported and the severity as estimated, and leaves out fields you
> did not provide. You send it through the city's own channel.
>
> The part most civic apps skip is afterwards. Civic Sense keeps two timelines
> apart: what you did about delivery, and what the city did about the problem.
> A report only earns the word "submitted" when a government system actually
> answers. Neighbors can add evidence — a photo of the fix, a verification
> vote — but only the city can close a case.
>
> No feed, no followers, no leaderboard. The server strips photo metadata
> and attempts to blur faces; blurring is not guaranteed. The public map
> shifts coordinates, but that is not a guarantee of location privacy.

## 3. Video script (90 seconds, portrait, one take per shot)

Record on the device with the backend running. Force-stop YouTube first, turn
on Do Not Disturb, and hide the status bar clock only if it shows notifications.

| # | Shot | Say (voice-over or live) |
|---|---|---|
| 0 | App icon → first launch (**Onboarding**) | "You see a problem on your street. This is what it takes to get it fixed." |
| 1 | Tap **Get started** → map opens, Impact/Settings tabs visible | "Civic Sense opens on your neighborhood, not a feed." |
| 2 | Tap the ink **Report** pad → camera → photograph a real pothole | "The photo is the report." |
| 3 | **Analysis**: confidence percentage, plain-language category, band and verdict | "On-device AI names it in milliseconds, offline — and it tells you how sure it is instead of pretending certainty." |
| 4 | Tap the correct category (or confirm) | "I confirm or correct it. The human stays the authority." |
| 5 | **Location**: pin drops, drag it across the street | "Location is captured now, once — never in the background." |
| 6 | **Route**: ranked channels, tap **Why this contact?** | "This is the part that makes people give up: who do I tell? It resolves the responsible office and shows why, from a verified registry — never an invented address." |
| 6b | *(if a nearby report exists)* duplicate sheet → **Add photo** | "Before filing, it checks for the same problem nearby. A neighbor already reported this one, so my photo becomes evidence on their case instead of a duplicate ticket." |
| 7 | **Report/Review**: compose view, the AI's one-sentence disclosure, privacy panel | "The letter reads like a letter — no robot tags in what the city receives. One line at the end says the severity was estimated; the location and issue details are what I reported. And here is exactly what leaves my phone." |
| 8 | Open the official form, tap "I sent it" → **Track** | "For Baltimore the city portal is the real channel. So it asks me straight out — and records 'sent by me, status unknown.' Not 'received', because it can't see that." |
| 9 | Track: two separate timelines | "My delivery, and the city's status. Only the city can move the second one." |
| 10 | **My Reports** docket (your own report) → resolved case from the map → community votes; show before/after only if real evidence is attached | "When it's fixed, neighbors can weigh in. If before/after photos are attached, they show the same spot over time." |
| 11 | **Impact** tab: filed, fixed, time to fix, category ledger | "The scoreboard is the city's numbers — not mine." |
| 12 | **Settings**: appearance, what leaves the phone, sources | "The app creates a device account. The server strips photo metadata and attempts face blurring, but it may miss faces or plates." |
| 13 | Share sheet from a case file | "A case file is a link, so a neighbor can follow the same repair." |

Close on the Impact tab with the app's own gold rule and the line:
"Notice it. Prove it. Get it fixed."

**Do not** show: any percentage changing while you talk (rerecord instead),
notifications, the notification shade, or split-screen.

## 4. What is real (and what to say if asked)

| Claim | Status |
|---|---|
| Photo → classify → confirm → locate → route → draft → send → track | Real, end to end, on the device + server |
| On-device classification | Real TFLite, ~40 ms, offline; trained on synthetic bootstrap images — say so |
| Server classification | MobileNet ONNX + zero-shot CLIP on real weights (`?engine=clip`) |
| Confidence shown in words | Real output; "—" when the model returns nothing usable |
| Contact routing | Curated registry, every entry has a source URL + verification status; honest manual fallback |
| Submission truth | "submitted" only after a real upstream 2xx; otherwise "sent by you, status unknown" |
| Duplicate handling | Read-only pre-flight lookup (same category, 25 m, 30 days); "Add photo" attaches to the existing report — no orphan drafts |
| Privacy | EXIF stripped server-side; face blurring is best-effort; map pins are shifted but not anonymized; the app creates a device account |
| Impact tab | Real SQL aggregates over the app's own reports; the screen says so |
| Limitations | Baltimore Open311 is offline → portal deep link; plates not blurred yet; rate limiter in memory |

## 5. Before you hit record

```bash
docker compose up -d db
cd server
.venv/bin/alembic upgrade head
.venv/bin/python -m scripts.seed_contacts
```

Then confirm the configured API's `/stats/impact` endpoint is reachable from
the phone. Clearing app data deletes the device session and locally queued
drafts, so do not clear it unless those are no longer needed.
