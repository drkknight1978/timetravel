# Timetravel

A first-person voxel sandbox about stepping outside time, returning to the past, and meeting a solid past self. Explore a small clearing, get to know its crew, forage, craft a camp, befriend wildlife and confront three enemies in the northern ruins. Rewind a fight, return from a different position and fight alongside the past self that repeats your first attempt. All models, textures, music and sound cues are original and generated locally.

## Run

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Open the address printed by Vite, normally **http://127.0.0.1:5173**. Click **Enter the clearing**. Your world and its history last for this session; reloading starts again.

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

## Controls

| Input                    | Action                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------- |
| WASD / mouse             | Walk / look                                                                         |
| Arrow keys               | Alternative look controls                                                           |
| Shift / Space            | Sprint / jump                                                                       |
| Left / right click       | Break / place with a building material selected; attack / sword guard with a weapon |
| 1–4                      | Unlimited timber, stone, earth, grass                                               |
| 5                        | Equip your selected crafted item                                                    |
| 6 / 7                    | Equip sword / crossbow                                                              |
| Hold V / G               | Keyboard alternatives: attack / sword guard                                         |
| E                        | Talk, gather, feed wildlife, use the workbench or refill a feeder                   |
| B                        | Open the field crafting kit                                                         |
| J                        | Read requests and the map                                                           |
| Q                        | Leave time / return at the selected moment                                          |
| Hold R / F               | Preview backwards / forwards                                                        |
| Mouse wheel outside time | Select 1×, 2×, 4× or 8× preview speed                                               |
| T outside time           | Return to clear ground beside a hole; time stays frozen                             |
| C outside time           | Cancel and restore the original time and player position                            |
| Escape                   | Pause and release the mouse; close a conversation or journal                        |

Gravity and character collision apply in both temporal modes. There is no flight. If mouse capture is unavailable, drag on the world to look and click without dragging to edit or attack. V and G also work without mouse capture. Safari may consume the first Escape to dismiss its pointer-capture notice. The on-screen rewind/forward buttons step five seconds.

## A world to explore

The 64 × 32 × 64 landscape has a shallow western pond, a stepped northern ridge, eastern woodland, a flower meadow and paths between them. The work sites remain flat and accessible. Tiny material textures, grass, flowers, warm camp lights and water ripples add detail while retaining the editable voxel world.

**Mira, Ash, Tess and Rue** have shaped faces, different skin tones and hairstyles, work clothes, fingers and boots. Their shoulders, elbows, hips and knees articulate. Walking, carrying, hammering, celebrating, breathing and blinking all follow simulation time. These are stylised human models, not photorealistic people. Player incarnations use the same proportions with gold or purple clothes.

Mira and Tess collect supplies and build. Ash and Rue dismantle and carry salvage home. They inspect completed jobs, celebrate and rotate between arches, gates, lookouts and stone spires. Workers navigate around changed terrain and characters. Approach and press **E** to talk, accept a favour, ask someone to wait for 20 seconds, follow for 30 seconds, or return to work. Orders expire in world time.

Two hares, **Clover and Pip**, and two deer, **Fern and Rowan**, explore the meadow. Offer berries to build trust. A fed animal pauses for a snack, then follows the person who fed it for a while. Friendly animals accept a gentle greeting. Sprinting near a shy animal can frighten it. Feeders attract nearby wildlife for one minute; **E** refills them with two berries.

## Fights in the northern ruins

Follow the path north from camp. Your **sword (6)** strikes nearby enemies; hold right click or **G** to guard against attacks from the front and greatly reduce their damage. Guarding is unavailable while attacking, sprinting or recovering from a strike. Your **crossbow (7)** fires unlimited bolts toward the crosshair. Hold left click or **V** to keep attacking as the weapon recovers. Slots **1–5** return to building. Blocks provide real cover; weapons do not harm the crew or wildlife.

Each enemy has a different silhouette, colour and approach:

| Enemy      | Behaviour                                                | Change the outcome                                                  |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| **Raider** | A quick fighter with short attack windups                | Guard a strike, create distance or interrupt its route with a wall. |
| **Warden** | A heavy fighter with a shielded front                    | Flank it, or strike during its long windup when the shield opens.   |
| **Hunter** | A ranged attacker that withdraws briefly when approached | Break line of sight with terrain and approach between shots.        |

You have **100 health**. Health, enemy attacks, weapon cooldowns and defeats belong to world time. When you return to the past, both your past self and the newly controlled character start with the historical player's health and remaining weapon cooldown at the selected moment. Your arrival does not reset the cooldown, and simply leaving time and returning at the present does not heal you.

If you fall, you can still press **Q**, move outside time and rewind before the defeat. The health display shows the selected historical moment. Return only when that player is alive and your arrival point is clear. Cancelling restores the original outcome, including defeat; there is no automatic healing.

A defeated enemy remains part of the recording. Rewind before its defeat and it returns. When you branch, your past self replays its **attack attempts**, aim, weapon changes and guarding. Attacks resolve against the new positions and cover, so an old hit can miss and an old defeat can be avoided. Past selves can also be defeated. They never rewind themselves.

## Foraging and crafting

Look for small ringed patches of timber, stones, fibre and berries. Approach, look toward the patch and press **E** to collect two supplies. Patches regrow after 30 seconds of world time. Breaking timber or stone also provides resources.

Press **B**, or use the workbench beside the starting path, to make a **trail lantern, campfire, wildflower planter or wildlife feeder**. The field kit shows costs, missing supplies and your crafted stock. Choose **Make & equip**, select **5**, then right click to place. Placement consumes one item only when it succeeds; breaking a crafted prop returns it to supplies. The first four building materials remain unlimited.

Supplies belong to the camp. They are shared across player incarnations, so returning to the past does not duplicate a bag. Requests, completed favours, animal trust, orders, regrowth and feeders all restore with history. Conversations, crafting menus and the journal pause the world; actions take effect when the menu closes.

## Try three experiments

**Meet your past self:** watch Mira build an arch and Ash dismantle it. Press Q, move somewhere clear, hold R until the arch exists again, then press Q. Your historical character becomes a solid purple past self. Stand in its route or build a wall across it: it attempts its old movement and edits against the changed world.

**Change a friendship:** feed Clover, leave time and rewind before the snack. The berry returns and the friendship disappears. Move clear and return to time. Your past self can repeat the feeding attempt. Lead Clover away first and the old attempt may no longer reach.

**Change a fight:** equip the sword or crossbow and fight the Raider north of camp. Leave time, move to the side, rewind before the first attack and return. Your past self repeats its approach. Flank the distracted enemy, guard an incoming blow or place cover across an old firing line. Watch the new outcome unfold. If you were defeated, rewind far enough that the health bar is above zero before returning.

## Temporal rules

- Keep five minutes of **simulation time**. Pauses, hidden tabs and time outside the flow do not consume the window.
- Terrain, actors, health, combat state, jobs, velocities, paths, timers, seeded randomness, camp state and replay cursors restore together. A destroyed block returns before its destruction.
- Preview is reversible up to the moment you left time. C restores that moment and your original position. Only returning into the past discards the later world history.
- A branch retains your temporal position and facing, turns the historical player into a past self, and creates a new controlled identity. Scripts contain attempted movement, edits, camp interactions, attacks, weapon selection and guarding. They never contain temporal powers or borrow another incarnation’s actions.
- Past selves obey current collisions, reach, visibility, cooldowns and resource costs. They idle at the end of their recording. Existing selves restore their own playback positions.
- Three past selves may exist at the selected moment. Rewind before an earlier arrival to free a slot. Returning at the present relocates the existing player without creating another self or changing health and weapon recovery.
- Occupied returns are blocked. If restored terrain traps you in a hole, press **T** or choose **Return to ground**. It finds a clear, supported surface nearby, offset from your position, and moves only the traveller. Time stays frozen: press **Q** when ready to resume, or **C** to cancel. It avoids characters, trees and props, keeps your facing, and changes no terrain or health. Ordinary movement still obeys walls and gravity.
- Worldlines are recordings, not predictions. Earlier trails are bright; later recorded segments are faint and dashed. Crew colours, purple past selves, gold player traces, cream wildlife traces and each enemy’s colour distinguish them. Arrival markers never draw a line across a teleport.

## Optional NPC intelligence

The crew and enemies can use **JEV for quick reactions** and **GPT-4.1 nano for short-term intentions**. These are bounded choices that affect real movement: workers can watch an unusual visitor, cautiously approach, or flee a nearby enemy; enemies can engage, circle either side, hold a position or retreat. They still obey terrain, pathfinding, reach, attack windups and cooldowns. Your explicit work orders take priority.

Provide `TYPESAFE_API_KEY` and `OPENAI_API_KEY` to the local Vite server as exported environment variables, or in an untracked `.env` file in this folder. `.env.example` contains names only. Existing exported variables take precedence over file values; update or unset an old exported value when replacing a key in `.env`. Restart `npm run dev` after changing credentials. `npm run preview` also provides the local AI service. A static copy of `dist` alone uses ordinary game rules.

Keys stay on the local server and never enter browser bundles. The services receive small batches of fictional game observations and allowed choices, not screenshots, conversations or files. **NPC AI ON/OFF** controls new AI requests; already-recorded intentions finish naturally (at most six seconds for reactions or thirty for plans in world time). The HUD shows the current connection state and a nearby NPC intention.

- Jev: at most one batch every five seconds and 300 simulation ticks; 120 attempts per server run; 2.5-second timeout. Choices below 60% confidence are ignored.
- OpenAI: fixed to **gpt-4.1-nano**, at most one batch every thirty seconds and 1,800 simulation ticks; 40 attempts per server run; 500 output tokens per call; 5-second timeout. There is no upgrade to a more expensive model.
- Batches contain at most seven nearby NPCs. Quiet routines, paused menus and temporal preview make no decision requests. Missing keys, service errors, exhausted limits and stale replies fall back to existing behaviour. A rejected key remains disabled until the server restarts.
- Only accepted choices enter the recording at a simulation tick. Rewind restores the exact intention and expiry; discarded future replies cannot enter a new branch. A new situation can lead to a different decision after time resumes. There is no persistent memory across reloads. Written conversations use the separate on-demand service described below.

The [TypeSafe quickstart](https://docs.typesafe.ai/introduction/quickstart) documents Jev's typed decisions. The [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-4.1-nano) lists nano at $0.10 per million input tokens and $0.40 per million output tokens, checked 4 October 2026. The local status endpoint reports provider call counts and estimated OpenAI token cost; Jev usage is counted separately. The limits reset when the local server restarts.

## Written conversations

Approach **Mira, Ash, Tess or Rue**, look at them and press **E**. Type in the conversation box and press **Enter** or **Send**; **Shift+Enter** adds a line. Suggested topics fill a draft without sending it. **Escape** or the close button returns to the world. Movement, fights and world time pause while you talk.

Each worker has a distinct voice: Mira is an imaginative architect, Ash a dry-humoured salvager, Tess a patient mason, and Rue a gentle wildlife enthusiast. Generated replies use their personality, current activity, nearby danger, camp supplies, favour progress and the last **six exchanges with that NPC**. Follow-up questions carry that context. They do not gain memories of an abandoned future.

Completed exchanges enter world history on the first tick after you close the conversation. Reopening shows earlier exchanges from this timeline. Rewinding before that tick removes them; previewing forward or cancelling restores them. A new branch preserves earlier memories and drops later ones. Pending replies are cancelled when you close, and stale replies cannot enter another timeline. Past selves replay gameplay attempts, not written dialogue.

The existing **favour and work-order buttons** remain beside the conversation. Written requests do not directly give items, change jobs, move NPCs or edit terrain; use those buttons for the actual action. The enemies and wildlife do not have written conversation panels.

Conversations use **GPT-4.1 nano only**, with no upgrade to a costlier model. The server allows at most **80 conversation attempts per server run**, separated by at least two seconds, with an eight-second timeout and a 300-output-token cap. Messages are limited to 500 characters, replies to 1,200 characters, and a paused conversation to twelve new exchanges. This allowance is separate from the automatic NPC planning limit. The API receives your typed message, recent exchanges and fictional game facts only when you press Send; keys stay server-side, responses use `store:false`, and no conversation files are written locally.

When the key is missing/rejected or the service fails, the panel clearly labels **Local replies**: limited topic-based responses, not generated AI. The game remains usable. Switching **NPC AI OFF** also keeps conversations local. Use the same local `OPENAI_API_KEY` setup described above to enable generated dialogue; a rejected key needs correcting and a server restart.

## Music

An original 40-second ambient score combines chords, a bell melody, bass and a light pulse. Music advances with world time, freezes outside time, and plays the actual recording backwards while holding R. Forward preview uses F. Both follow the selected 1×–8× speed, with tape-like pitch changes. Branching, cancelling, pausing and reaching history boundaries keep playback aligned.

**Sound on/off** mutes everything. The **Music** slider adjusts music separately from effects. Forward/reversed stereo buffers use about 14.7 MiB, separate from history storage. No downloads or music service are needed.

## Validation

The current build passes **286 automated checks**, type checking and the production build. Coverage includes the existing world, crew, wildlife, crafting, history, branching and music checks, plus weapon range and cover, friendly interception, guard direction, Warden openings, Raider pursuit, Hunter retreat, defeat restoration, frozen combat, altered past-self attacks, explicit weapon switching, immutable animation poses and bounded visual effects. Conversation checks cover provider limits and failures, follow-up context, cancelled and stale replies, paused typing, exact timeline memory, immediate reopening and history storage.

On this Mac, the **4 October 2026 Chrome walkthrough** verified a lost fight, rewinding from zero health to full health, moving clear, creating a past self and defeating the Raider on the changed timeline while the controlled player retained full health. First-person sword/crossbow models and the three enemy silhouettes were visually checked. Live and temporal samples settled around **60 fps at 1920 × 1080**. These are short local samples, not a guarantee on other hardware or a full-duration combat soak.

The earlier **Safari combat smoke check** verified a crossbow hit, frozen combat, rewinding the Raider from 31 to 55 health, moving to a different return point, and a new past self replaying the shot. Safari also rendered the weapon and enemy models correctly.

On **4 October 2026**, the rescue/AI update was checked in Chrome: a recorded excavation was rewound to filled terrain, T moved the trapped traveller to clear ground, and Q created a valid branch. The same rescue/return loop passed in Safari. Live JEV choices (`watch` and `engage`) entered actor history; rewinding restored the earlier intention and health, and returning created a valid new branch. Chrome samples at the normal 1512 × 769 viewport settled near **60 fps**. At the time of this walkthrough, the exported OpenAI key was rejected by the provider. Nano planning was therefore covered by mocked responses; the later successful conversation check is recorded below.

The **4 October 2026 written-conversation walkthrough** passed in Chrome: sending a question and a follow-up, typing without advancing world time, reopening earlier exchanges, removing them by rewinding, restoring them by previewing forward, and branching before the conversation to clear the NPC’s memory. Safari passed opening, sending, receiving and returning to the live world. These initial browser checks used clearly labelled **Local replies** while the configured OpenAI key was rejected; generated replies were covered by mocked tests at that stage. A five-minute stress test with 80 maximum-length conversations, 15 actors and three full replay scripts retained **61.41 MiB** across 18,001 frames (estimate 61.47 MiB).

Later on **4 October 2026**, a replacement OpenAI key passed authentication from a fresh Terminal environment. The game server was restarted with that environment, and a real browser conversation produced a **GPT-4.1 nano AI reply** from Mira about adding a sheltered bench and plants. The conversation service recorded one successful request and an estimated token cost of **$0.0000732**. Written AI conversations are now live-verified; this check did not separately exercise automatic nano planning.

The updated five-minute AI stress test retains **427 decision updates** across seven NPCs and measured **61.22 MiB** of retained history (estimate 61.21 MiB). Guard-toggle stress measured **62.33 MiB**. These remain under the 64 MiB target.

The earlier five-minute combat tests retain **18,001 frames**, four workers, four animals, three enemies, one player, three past selves and three full-length replay scripts. Node/V8 retained heap plus array buffers measured **60.86 MiB** in the baseline case and **62.40 MiB** when all four player incarnations repeatedly raised and lowered their guards. The in-game history estimate was **60.96 MiB**. This excludes renderer/GPU and music storage; edit patterns and JavaScript engines can change the result. Immutable combat states and bounded sharing caches keep repeated inputs compact.

For repeatable checks while the development server runs:

- `/?diagnostics` shows frame rate, history size, camp/actor state and render counts.
- `/?diagnostics&playtest` adds a clearly labelled **development-only** scene-staging toolbar for camp, crew, wildlife, terrain and combat walkthroughs. **Hole** records a four-block excavation and fall, then previews the intact ground so T/Q can be checked. **Arena** moves the player seven metres from the Raider and faces the encounter; it does not heal, damage, reset or otherwise change the combat state. These staging tools are not included in production builds.
- `/tests/combat-preview.html` shows all three enemy rigs with activity, angle and close-up controls.
- `/tests/crew-preview.html` shows the actual human rigs with activity, angle and close-up controls.
- `/tests/music-browser.html` verifies real Web Audio output in either browser.
- `npm test -- --disableConsoleIntercept` prints the history-memory benchmark.

## Implementation and limits

TypeScript, Three.js, Vite and Vitest. Rendering reads authoritative state without changing it. Terrain uses exposed-face meshes in 16³ chunks. The simulation runs at 60 Hz with interpolation; actor commands resolve in player, past-self creation order, worker ID, animal ID, then enemy ID order.

`simulation.ts` owns behaviour and interactions; `combat.ts` defines weapons and enemy combat; `camp.ts` defines supplies/recipes/requests; `history.ts` packs exact actor and command data with reversible voxel deltas and compressed full checkpoints every two seconds. Immutable camp/combat states and paths are shared across frames. Attack attempts are packed into the existing command flags; damage is resolved again against the current world. Crossbow shots use instantaneous hit tests with short cosmetic tracers. `temporal.ts` handles preview and branching. `humans.ts`, `animals.ts`, `combat-visuals.ts`, `scenery.ts` and `renderer.ts` provide original models and presentation; `interactions.ts` provides camp UI.

This is a local creative prototype. Crafting props occupy one solid voxel even where their visible shape is smaller. Terrain has no structural physics; pond water is shallow scenery, not fluid simulation. There is no persistent save, multiplayer, infinite terrain or public hosting. Weapons have unlimited ammunition for this creative prototype, and combat is deliberately stylised without gore.
