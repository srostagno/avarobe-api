# Stylist evals

Checks that the stylist delivers what people ask for and learns their taste. They call the real planning and learning code (`src/modules/looks`, `src/modules/taste`) with fictional clients (body and palette only, no photos). They cost text tokens only: no images are rendered.

Run from `avarobe-api/` (the `.env` must have `OPENAI_API_KEY`):

```bash
corepack pnpm exec tsx evals/stylist/briefs-eval.ts old,new-5.5 "" 3   # arms, briefs (empty = all), runs
corepack pnpm exec tsx evals/stylist/learning-eval.ts "" 5             # personas (empty = all), rounds
corepack pnpm exec tsx evals/stylist/remix-eval.ts evals/stylist/out/briefs-<stamp>.json
```

Results land in `evals/stylist/out/` (git-ignored).

- **briefs-eval**: 14 briefs with explicit asks (a named icon, music, an era, "no heels", "hate pink", the weather), 3 looks each. A gpt-5.5 "fashion editor" scores every look on adherence, fidelity to the named style, weather, coherence and flattering, and says whether it's a hit ("exactly what I asked for"). The judge sees only the garments, never the stylist's pitch. `old` is the prompt as it was on 27-sep-2026 (`baseline.ts`).
- **learning-eval**: four simulated clients with hidden, opposite tastes (rocker, Scandinavian minimalist, romantic colorist, classic prep) react to 3 looks per round like a busy app user (thumbs, a chip or two, a tapped piece, rarely a few words). The app's own learning turns reactions into a taste profile for the next round. Arms: no learning (control), learning, and learning plus a one-line statement. Also rates the last round with an editor who doesn't know their taste, so taste can't quietly cost the basics.
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
