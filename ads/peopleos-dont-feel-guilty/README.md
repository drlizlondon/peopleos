# PeopleOS paid-social ad — “Don’t feel guilty”

A reusable 1080 × 1920, 30 fps Remotion composition for TikTok and Instagram Reels. The default cut is 13.5 seconds and intentionally has no audio dependency, so the full story works with sound off.

## Preview and render

From this folder:

```sh
npm install
npm run studio
npm run render
```

The final MP4 is written to `out/peopleos-dont-feel-guilty.mp4`. Use `npm run render:preview` for a half-size review render and `npm run still` for an end-card PNG.

## Make another variant

Edit `src/config.ts`. All replaceable material is in `defaultAdConfig`:

- `copy` holds the opening, bridge, end line, and CTA.
- `scenario` holds the person, private notification, conversation starter, and five day moments.
- `timings` holds every scene’s start and end time in seconds.
- `durationSeconds` controls the composition length.

The UI demonstration follows the product’s real behavior: the private iPhone reminder contains no person’s name; opening it reveals Today, a conversation starter, and the Message/Call routes. Message does not imply that PeopleOS sent anything automatically.

## Paid-social guardrails

- Keep essential copy inside the composition’s built-in safe area.
- Keep the reminder body anonymous for privacy.
- Use one CTA only. This version intentionally has no “Follow us” prompt.
- Keep exports between 10 and 15 seconds unless the media plan changes.
