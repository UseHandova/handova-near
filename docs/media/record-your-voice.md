# Narrate the demo video in your own voice

The demo video is built from **25 short voice clips**, one per line below. Each clip is its own file, so the video can match every scene to its line, and you can redo one line without touching the others.

You can record the clips yourself (this guide), or generate them with YarnGPT (`scripts/voiceover-yarngpt.mjs`). Either way the video is built the same way.

---

## 1. Before you record

- **Room:** a small, quiet room with soft things around you (a bedroom with curtains, or inside a wardrobe of clothes). Avoid tiled kitchens and bathrooms; they echo. Switch off fans and AC.
- **Phone:** iPhone **Voice Memos** or Android **Recorder** is enough. Hold the phone about a hand's width (15–20 cm) from your mouth, slightly to the side so your breath doesn't hit the mic.
- **Earphones with a mic** (wired EarPods) sound even better: clip the mic near your chin.
- **Same setup for all 25:** same room, same distance, same time of day, so the clips sound like one recording.

## 2. How to speak

- **Warm and calm, like telling a friend a story.** Not like an advert, not like reading.
- **Smile slightly while you speak.** It changes the tone, and people can hear it.
- **Slower than feels natural.** The video plays at 1.2× speed, so a relaxed pace will sound just right.
- **Pause half a second** at each full stop and comma.
- Say **"Near"** (like the English word), **"U-S-D-C"** (letters), **"N-F-T"** (letters), **"D-A-O"** (letters), **"Han-DOH-vah"**.
- **Leave 1 second of silence** before and after each line. The cleanup script trims it.
- **Made a mistake?** Stop, wait two seconds, and record the whole line again as a new file. Keep only the good take.

## 3. The 25 lines

Save each recording with the name in the **File** column (for example `hello.m4a`, `ll1.m4a`). The extension doesn't matter: .m4a, .mp3, .wav, .aac all work. Upper or lower case doesn't matter either.

| # | File | Scene | Say |
|---|---|---|---|
| 1 | `hello` | Opening, over the landing page | Hi, my name is Philip, and this is my project submission for the NEAR hackathon. It is called Handova. |
| 2 | `intro` | Opening, over the landing page | In Lagos, renting a home often means paying a full year up front, plus agent fees, to people you have just met. Getting your caution deposit back depends on goodwill. Handova puts the rent in escrow on NEAR, until you move in. Here is how it works. |
| 3 | `ll1` | Landlord (Ade) | Meet Ade, a landlord in Lagos. He creates a Handova account in seconds. The key stays on his phone. No wallet app, no gas. |
| 4 | `ll2` | Landlord (Ade) | He describes his flat in Pidgin, and NEAR AI turns it into a listing, inside a secure enclave that the server verifies. |
| 5 | `ll3` | Landlord (Ade) | He checks the details and publishes it on NEAR. Handova pays the gas. |
| 6 | `mum` | Mum | Across town, Mum needs a new home. She gets an account too. |
| 7 | `nr1` | Nurse (daughter) | Her daughter, a nurse in London, finds Ade's flat for her. No agent fee. |
| 8 | `nr2` | Nurse (daughter) | She pays for her mum, with USDC on NEAR, or from Base, Solana or Ethereum through NEAR Intents. |
| 9 | `nr3` | Nurse (daughter) | This is a live NEAR Intents quote. On testnet the deposit is simulated, because Intents only runs on mainnet. |
| 10 | `nr4` | Nurse (daughter) | One tap, and the rent and caution are locked in the escrow contract. Not with Ade, and not with Handova. |
| 11 | `ll4` | Landlord (Ade) | Ade hands Mum the keys, and marks the handover in the app. |
| 12 | `mm1` | Mum | Mum confirms she has moved in. Only now does Ade get paid. |
| 13 | `mm2` | Mum | Mum now holds a lease NFT. It carries the right to her caution fee, and its picture and status are drawn on chain. |
| 14 | `mm3` | Mum | And Handova speaks her language: Yoruba, Hausa, Igbo, Pidgin or English. |
| 15 | `ll5` | Landlord (Ade) | Ade withdraws his rent, in full. |
| 16 | `mm4` | Mum | Months later, Mum has to move to Abuja. Instead of losing the rest of her rent, she offers her lease to a new tenant. |
| 17 | `ll6` | Landlord (Ade) | Ade checks the new tenant's rental passport. No lease changes hands without him, so he agrees. |
| 18 | `to1` | Tolu | Tolu needs a flat, and finds Mum's lease on the home page. |
| 19 | `to2` | Tolu | He takes it over in one payment. Mum gets her money back, and the lease NFT, with its caution right, moves to Tolu. |
| 20 | `to3` | Tolu | A year later, Tolu moves out. |
| 21 | `ll7` | Landlord (Ade) | Ade claims part of the caution for a broken door. |
| 22 | `to4` | Tolu | If they cannot agree, a council DAO on NEAR decides. Two of three votes, no single judge. But Tolu offers to settle. |
| 23 | `ll8` | Landlord (Ade) | Ade accepts, and the contract pays out the split. |
| 24 | `to5` | Tolu | Tolu withdraws the rest of his caution, and his finished lease joins his rental passport, ready for his next landlord. |
| 25 | `outro` | Closing card | Handova solves one of the biggest housing problems in Lagos, for millions of renters. Rent without the agent, and without the fear. Thank you for watching. |

**Tip:** Voice Memos names recordings "New Recording 1, 2, …". Rename each one right after you record it (tap the name), or record them in order and rename them all at the end with the table above.

## 4. Get the clips to the computer

1. **Make a folder** called `my-voice` inside the project folder (next to `README.md`). It is git-ignored, so your recordings are never pushed.
2. **Move all 25 files into it.** From an iPhone: select the recordings in Voice Memos → Share → AirDrop to your Mac → move them into `my-voice`. From Android: share them to Google Drive or WhatsApp yourself, then download them on the Mac.

## 5. Clean them up and check nothing is missing

```sh
FFMPEG=/path/to/ffmpeg node scripts/prepare-voice.mjs my-voice voice-own
```

This trims the silence at the start and end of every clip, removes low rumble (fans, traffic), and levels the loudness so no line is louder than another. It prints each clip's length, and if any file is missing or misnamed it tells you which one.

**Listen to a few** in `voice-own/` before going on. If one sounds bad, re-record just that line, put it in `my-voice`, and run the command again.

## 6. Build the video

The app must be reachable: either the live site, or locally with `bun run server` and `bun run dev`.

```sh
# Record the footage on testnet, timed to your voice (about 4 minutes; four phones play the story)
DEMO_AUDIO=voice-own DEMO_URL=https://handova-near.vercel.app/ node scripts/record-demo.mjs demo-out

# Put it together: landing-page opening, the story, the closing card
DEMO_AUDIO=voice-own FFMPEG=/path/to/ffmpeg node scripts/compose-demo.mjs demo-out handova-demo.mp4
```

The video comes out as `handova-demo.mp4`. What the compose step does for you:
- Every scene lasts exactly as long as your line, and the captions show the same words.
- **Silences are fast-forwarded:** while nobody speaks (a transaction confirming, a page loading) the footage speeds up so each pause is about half a second. Change it with `DEMO_GAP_SECS` (e.g. `DEMO_GAP_SECS=1`).
- **The whole video plays at 1.2×.** Change it with `DEMO_SPEED` (`DEMO_SPEED=1` for normal speed).

## 7. Changing the words

All lines live in [`scripts/demo-voiceover.mjs`](../../scripts/demo-voiceover.mjs). If you change a line there, record that line again, then run steps 5 and 6. The captions update by themselves.

## If something goes wrong

| Message | What to do |
|---|---|
| `Missing 2 clip(s): nr3, to4` | Those files are missing or misnamed in `my-voice`. Check the names against the table. |
| `No recorded clip for "ll5"` | Run step 5 first, and use `DEMO_AUDIO=voice-own` (the cleaned folder), not `my-voice`. |
| A clip is cut off at the start | You started speaking instantly. Re-record with a 1-second pause before speaking. |
| The recording step fails partway | Usually testnet was slow. Run the same command again. |
