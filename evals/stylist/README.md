# Stylist evals

Checks that the stylist delivers what people ask for and learns their taste. They call the real planning and learning code (`src/modules/looks`, `src/modules/taste`) with fictional clients (body and palette only, no photos). They cost text tokens only: no images are rendered.

Run from `avarobe-api/` (the `.env` must have `OPENAI_API_KEY`):

```bash
corepack pnpm exec tsx evals/stylist/briefs-eval.ts old,new-5.5 "" 3   # arms, briefs (empty = all), runs
corepack pnpm exec tsx evals/stylist/learning-eval.ts "" 5             # personas (empty = all), rounds
corepack pnpm exec tsx evals/stylist/remix-eval.ts evals/stylist/out/briefs-<stamp>.json
corepack pnpm exec tsx evals/stylist/dressy-eval.ts 2 <label> [briefs,fixes] [miss id prefixes]
```

Every run prints its token use and an estimated cost (prices assumed, override with `EVAL_PRICE_IN` / `EVAL_PRICE_OUT`). A full dressy-eval run is about 68 calls, roughly $2.

Results land in `evals/stylist/out/` (git-ignored).

- **briefs-eval**: 14 briefs with explicit asks (a named icon, music, an era, "no heels", "hate pink", the weather), 3 looks each. A gpt-5.5 "fashion editor" scores every look on adherence, fidelity to the named style, weather, coherence and flattering, and says whether it's a hit ("exactly what I asked for"). The judge sees only the garments, never the stylist's pitch. `old` is the prompt as it was on 27-sep-2026 (`baseline.ts`).
- **learning-eval**: four simulated clients with hidden, opposite tastes (rocker, Scandinavian minimalist, romantic colorist, classic prep) react to 3 looks per round like a busy app user (thumbs, a chip or two, a tapped piece, rarely a few words). The app's own learning turns reactions into a taste profile for the next round. Arms: no learning (control), learning, and learning plus a one-line statement. Also rates the last round with an editor who doesn't know their taste, so taste can't quietly cost the basics.
- **dressy-eval**: womenswear occasions real clients rated down (a cocktail-attire wedding, a date at a cocktail bar, the same wedding with "floor-length, no slit, no jacket" asked up front, a business-casual office day, everyday boho), one look per plan, plus fixes of 19 real disliked looks from their real feedback (`misses.ts`: garments and feedback only). Eleven of those are steps of real fix chains (a cocktail wedding, everyday boho, the office) where every fix was rated down again: each step is fixed with every earlier look and its feedback as history, the way the app sends it. Hard constraints from their own words are checked by code (a dress, floor length, no slit, no outer layer nobody asked for, no mauve, a peasant blouse, no crew neck, no jean skirt, no bootcut, full-length pants, clearer colors than the look called too soft) along with the template, mother-of-the-bride pieces, "dated" office formulas (a cardigan over a shell, ankle trousers, block-heel pumps, ponte skirts, pearl studs), office pieces on dates, a rejected piece coming back and a liked piece dropped. The judge is told what this audience (US women 35 to 65) rejected, sees the whole chain, and lists every one of her words the outfit breaks and whether it reads frumpy.
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

## Fix chains and explicit asks, 2-oct-2026

Only 11 of 36 rated looks got a thumbs up (25 down, from US clients). The thumbs down, by failure (a look can have several): dated or frumpy styling 10 ("pretty grandma even for work", "I look frumpy"), colors too muted or disliked 9 ("sage is too muted", "a little too soft", "more saturation", "no mauve"), an outer layer nobody asked for 8 (coats, a tuxedo blazer, cardigans, a sheer wrap, a denim jacket), an explicit ask lost in a fix 4 (a dress turned into a jumpsuit, floor length turned midi, "I love peasant blouses" turned into a crew-neck tee, a terracotta she liked dropped), the satin wrap template 3, lengths and cuts 3 (ankle pants, bootcut, floor length), office pieces on a date 1, the picture softer than the labeled colors 1, hair without body 1. 9 of the 10 fixes were rated down: a cocktail-wedding guest went through four in a row ("floor length, flowy, no slit" got a jumpsuit and a tuxedo blazer; "I want a dress" got a chiffon gown and a coat; "an off-shoulder velvet dress bunched at the waist" got it midi, mauve and with a coat; "Full length no mauve no jacket").

Why: a fix only saw the look it fixed and its feedback, never what they said earlier in the chain, nor their brief's notes and asks; the fix rules turned any disliked dress into "no dress at all" and changed everything they didn't criticize; the prompt suggested jackets and coats for evenings; nothing said their words beat the dress code's usual length or the palette; and the image prompt named colors without their hex, on a warm-grey backdrop with soft lighting.

Now their words (brief, notes, every piece of feedback in the chain) are hard rules written out before designing (`hardRules`) and beat the dress code, palette, taste profile and defaults; a remix reads the whole chain (`looks/history.ts`) and the brief's notes (now stored on the look); a fix changes what was criticized and keeps the rest; no outer layer unless asked, needed for the weather, the dress code (menswear) or the look's hero; current styling for women 35 to 65 instead of the frumpy office formulas; at least one clear color per look; and the image prompt gives each garment its exact hex, at true saturation, on a neutral backdrop.

| dressy-eval, 1 run each, same judge | prompt of 30-sep | new prompt |
|---|---|---|
| New looks (15): hit | 60% | 100% |
| Modern (0-10) / frumpy | 7.4 / 7% | 8.1 / 0% |
| Office looks: hit / dated formula | 33% / 100% | 100% / 0% |
| Outer layer at a cocktail wedding / bar date | 100% / 100% | 0% / 0% |
| Fixes (19): hit | 26% | 100% |
| Fixes: feedback honored (0-10) / frumpy | 6.3 / 26% | 9.2 / 0% |
| Hard rules broken, by code | 18 in 11 fixes | 1 in 1 (clarity 3.2 vs 3.3) |
| Her words broken, per the judge | 24 in 10 fixes | 0 |
| Chain steps (9): hit | 11% | 100% |

The wedding chain, step by step (each fixed with the real earlier steps as history): the old prompt gave silk separates with a floor-length skirt, a one-shoulder satin midi with an evening coat, an off-shoulder velvet midi with a coat, and a wide-leg jumpsuit; the new one gives a floor-length chiffon gown with a ruched waist, a floor-length chiffon dress, an off-shoulder velvet floor-length dress with a gathered waist, and a full-length off-shoulder velvet gown in plum, with no slit, no mauve and no layer.

The 14 briefs held: 81% hits on the new prompt (1 run) against 82% recorded for the 30-sep prompt, with 2 violations. The judge reads garments only, so renders (the hex colors, the hair) are not covered here.
