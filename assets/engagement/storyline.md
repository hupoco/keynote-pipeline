# Engagement by Hupo — showcase video

Three-minute capability tour of the manager dashboard (Engagement) for Hupo's AI voice platform
for high-volume outbound calling. Narrated in the Chat register: short declarative lines, triads,
the hook returned at the close.

**Source of truth for the cut is `beats.json`** — every line of voiceover and every frame choice
lives there. This file is the human-readable brief that matches it.

## Build

```bash
python3 assets/engagement/build.py --draft    # quick 960x540 timing check
python3 assets/engagement/build.py --gen-vo   # synthesize narration (needs ElevenLabs env vars), then build
python3 assets/engagement/build.py            # full 1080p build
```

Frames go in `frames/` as PNG, named exactly as below. They are the frames on the Figma page
"Kelly's Playground (2)" in the *Agentic Outbound* file. Any missing frame renders as a labelled
placeholder so the cut can still be timed.

| File | Figma frame |
|---|---|
| `01-landing.png` | Landing page |
| `02-script-picker.png` | Script picker (dialog, laid over 01) |
| `03-dashboard.png` | Dashboard page |
| `04-leads.png` | Leads page |
| `05-lead-sidebar.png` | Lead Information sidebar |
| `06-leads-transcript-redacted.png` | Leads page - transcript redacted |
| `07-import-leads.png` | Import Leads *(not in the cut yet)* |
| `08-leads-create-batch-1.png` | Leads page > Create call batch (1) |
| `09-leads-create-batch-2.png` | Leads page > Create call batch (2) |
| `10-calls.png` | Calls page |
| `11-calls-create-batch.png` | Calls page > Create call batch |
| `12-calls-batch-scheduled.png` | Calls page > Call batch scheduled *(not in the cut yet)* |
| `13-batch-detail.png` | Call batch detail page |
| `14-batch-detail-transcript-redacted.png` | Call batch detail - transcript redacted *(not in the cut yet)* |
| `15-batch-retry-unreached.png` | Call batch detail > Retry unreached leads |
| `16-settings-frequency-1.png` | Settings page > Call frequency |
| `17-settings-frequency-2.png` | Settings page > Call frequency (2) |
| `18-settings-hours.png` | Settings page > Calling hours |
| `19-settings-blackout-dialog.png` | Settings page > Calling hours > Set blackout date (dialog, laid over 20) |
| `20-settings-hours-2.png` | Settings page > Calling hours (2) |
| `21-settings-changelog.png` | Settings page > Change log |
| `22-report-leads.png` | Leads page report |
| `23-report-lead-sidebar.png` | Lead information sidebar report |
| `24-report-calls.png` | Calls page report *(not in the cut yet)* |
| `25-report-batch-1.png` | Call batch detail report (1) |
| `26-report-batch-2.png` | Call batch detail report (2) *(not in the cut yet)* |

## Disclaimers

- **Opening card (4 s, before the first screen):** "All leads, names and call records shown are
  fictional demo data. Any resemblance to real people is coincidental."
- **Corner line (bottom right, every screen after the card):** "Demo data. Names and details
  shown are fictional."

## Storyline

| # | Beat | Screens |
|---|---|---|
| 0 | Cold open | Landing |
| 1 | One company, many scripts | Script picker → Dashboard (sidebar) |
| 2 | Dashboard | Dashboard |
| 3 | Leads | Leads table → Lead sidebar → Redacted transcript → Lead sidebar (outcome) |
| 4 | Batches | Leads > Create batch (1)(2) → Calls > Create batch → Calls table → Batch detail → Retry unreached |
| 5 | Settings | Call frequency (1)(2) → Calling hours → Blackout dialog → Calling hours (2) → Change log |
| 6 | Reports and roles | Leads report → Lead sidebar report → Batch report → Calls (Admin screen) |
| 7 | Close | Landing |

## Voiceover

**0. Cold open**
> Every call, every outcome, every rule.
> Your team places thousands of calls a week.
> Who was reached. Who said yes. Who can't be called again until Thursday.
> The answers exist. They're scattered across sheets, dialler logs and someone's inbox.
> So what if they were one screen away?
> This is Engagement.
> One place to run outbound at scale, inside the rules you've already approved.

**1. One company, many scripts**
> One company. Several use cases.
> Log in, and it asks which one you're here for.
> Pick a script, and everything you see belongs to it.
> Change it from the sidebar, and every page follows.

**2. Dashboard**
> Scoped, measured, current.
> The dashboard reads the way the call was meant to end.
> For a callback script, that's meetings agreed.
> For another, it might be consent given.
> The metric follows the outcome, not the other way round.

**3. Leads**
> Every lead you imported, with everything you imported it with.
> Open one, and the calls it has had are right there.
> Then the transcript itself.
> PII is masked in the transcript before anyone reads it.
> And for a callback script, the outcome stands on its own line: when the lead is free for a callback.

**4. Batches**
> Two ways to put the AI on the phone.
> Choose the exact leads you want, and send them.
> Or set a batch size, and let it take the next thousand.
> Every batch you've run is a record. When it ran, how many connected, how each one ended.
> Open a batch, and it's the same picture, call by call.
> The ones that didn't land, no answer, voicemail, a dropped line, come back in one retry.
> And only the ones still eligible go out again.

**5. Settings**
> Configured, enforced, recorded.
> Every script has its own rules.
> How often one person can be called, in a week or in total.
> When the AI is allowed to call, down to the day. And the dates it never will.
> The system holds the line on every batch and every retry.
> And every change is logged: who, what, when.

**6. Reports and roles**
> Everything you've seen, exportable.
> The leads you imported. Every call behind every lead.
> And two ways in. Admins set and send. Agents see.

**7. Close**
> Thousands of calls. One screen.
> Engagement by Hupo.

## Decisions so far

- Product name in the close: **Engagement by Hupo**.
- "the next thousand" and "thousands of calls a week" are approved as stated.
- Retry respects frequency caps ("only the ones still eligible go out again") — confirmed.
- Agent role runs over an Admin screen; the UI is the same minus the edit actions.
- Transcript shown once, on the Leads flow, using the redacted frame.
- Voiceover: ElevenLabs, voice `qSeXEcewz7tA0Q0qk9fH`, one clip per shot so each screen
  paces to its own lines.

## Still to do

1. Export the 26 frames (needs `www.figma.com` allowed in the environment's network policy, or
   PNGs exported by hand into `frames/`).
2. `--gen-vo` once `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` are set on the environment.
3. Review the full 1080p build; tune `focus` / `kind` per shot in `beats.json` where a push-in
   should land on a specific control (e.g. the sidebar selector, the retry button).
