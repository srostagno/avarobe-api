# Stylist evals

Checks that the stylist delivers what people ask for and learns their taste. They call the real planning and learning code (`src/modules/looks`, `src/modules/taste`) with fictional clients (body and palette only, no photos). They cost text tokens only: no images are rendered.

Run from `avarobe-api/` (the `.env` must have `OPENAI_API_KEY`):

```bash
corepack pnpm exec tsx evals/stylist/briefs-eval.ts old,new-5.5 "" 3   # arms, briefs (empty = all), runs
corepack pnpm exec tsx evals/stylist/learning-eval.ts "" 5             # personas (empty = all), rounds
corepack pnpm exec tsx evals/stylist/remix-eval.ts evals/stylist/out/briefs-<stamp>.json
corepack pnpm exec tsx evals/stylist/dressy-eval.ts 2 <label>         # runs, a label for the output file
```

Results land in `evals/stylist/out/` (git-ignored).

- **briefs-eval**: 14 briefs with explicit asks (a named icon, music, an era, "no heels", "hate pink", the weather), 3 looks each. A gpt-5.5 "fashion editor" scores every look on adherence, fidelity to the named style, weather, coherence and flattering, and says whether it's a hit ("exactly what I asked for"). The judge sees only the garments, never the stylist's pitch. `old` is the prompt as it was on 27-sep-2026 (`baseline.ts`).
- **learning-eval**: four simulated clients with hidden, opposite tastes (rocker, Scandinavian minimalist, romantic colorist, classic prep) react to 3 looks per round like a busy app user (thumbs, a chip or two, a tapped piece, rarely a few words). The app's own learning turns reactions into a taste profile for the next round. Arms: no learning (control), learning, and learning plus a one-line statement. Also rates the last round with an editor who doesn't know their taste, so taste can't quietly cost the basics.
- **dressy-eval**: the dressy womenswear occasions real clients rated down on 28-30 Sep 2026 (a cocktail-attire wedding, a date at a cocktail bar, an anniversary dinner), one look per plan, plus fixes of the 8 real disliked looks from their real feedback (`misses.ts`: garments and feedback only). Its judge is told what this audience (US women in their 50s and 60s) rejected; hand checks count the template (a satin wrap midi dress, block-heel sandals with an envelope clutch), mother-of-the-bride pieces (sheer wraps, shawls, boleros, cropped evening jackets, embellished flats), dates labeled as cocktail attire, office pieces on dates, and fixes that bring back what was rejected (a dress after "not a dress", a sheer layer, the same kind of shoe).
- **remix-eval**: variants of one look per brief (new colors, winter, dressier, another occasion, surprise), judged on keeping the style DNA and applying the change.

## Results on 27-sep-2026

| Brief adherence (3 runs, 126 looks per arm) | hit | adherence | fidelity | violations | seconds per plan |
|---|---|---|---|---|---|
| Old prompt, gpt-5.4-mini low | 59% | 8.1 | 7.3 | 25 | 9 |
| New prompt, gpt-5.5 low | 84% | 8.7 | 8.2 | 9 | 19 |

The real brief that went wrong ("Steve McQueen style, hard rock, summer barbecue") went from 2 hits in 9 looks to 6 in 9. gpt-5.5 at medium effort scored about the same (88%) at 27 s, so production uses low.

| Learning (4 personas, 5 rounds) | satisfaction per round (1-5) | love it (rounds 2-5) | look has a dealbreaker |
|---|---|---|---|
| No learning | 2.9 → 3.1 | 33% | 71% |
| Learning from feedback | 2.9 → 3.9 → 4.3 → 4.3 → 4.4 | 83% | 15% |
| Learning + one-line statement | 4.3 → 4.5 | 94% | 15% |

Remixes: 99% judged great remixes, style DNA 8.8/10, change applied 8.6/10.

Known trade-off: when someone's taste fights the weather (leather and boots for an early-summer day trip), the editor's weather score drops from 9.0 to about 7.5. The stylist translates the taste to the season (linen, suede) rather than dropping it.

## Dressy occasions, 30-sep-2026

Every cocktail-wedding and cocktail-bar-date look real clients rated came back thumbs down (9 of 9): the stylist dressed every dressy occasion in the same satin wrap midi dress with block-heel sandals and a clutch, added sheer wraps, labeled a date at a bar "Cocktail attire", and its fixes brought back what was rejected. The prompt now sets formality from the event rather than the venue's name, bans the template and mother-of-the-bride pieces unless asked, keeps wedding guests out of white, and has fixes replace each disliked piece with a different kind of piece.

| dressy-eval, 2 runs, same judge | old prompt | new prompt |
|---|---|---|
| New looks: hit | 11% | 89% |
| Template / mother-of-the-bride | 67% / 44% | 0% / 0% |
| Dates labeled cocktail attire | 100% | 0% |
| Fixes: hit | 31% | 75% |
| Fixes: feedback honored (0-10) | 5.6 | 8.2 |
| Fixes that bring back a rejected piece | 6 of 16 | 1 of 16 |

The 14 briefs didn't move: old prompt 82% hits (2 runs), new prompt 82% (2 runs), same adherence, fidelity and violations.
