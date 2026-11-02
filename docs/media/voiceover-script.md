# Demo video voice-over script

25 short clips. Record or generate **each clip as its own audio file** and name it exactly as in the **File** column (`.wav`, `.mp3` or `.m4a` all work). Put them all in one folder, e.g. `voice/`.

The words match the on-screen captions, so please keep them as written (small natural changes are fine). The video waits for each clip to finish, so a clip can run longer than the "Robot length". Aim for a calm, warm Lagos voice, not rushed.

Tips for YarnGPT: generate one clip at a time (each is far under the 1,000-character limit), use the same voice for every clip, and download each one with the file name below. Spell "NEAR" as **"Near"** and "USDC" as **"U-S-D-C"** if the voice reads them oddly. "NFT" reads fine as letters.

## Opening: the landing page

| File | Robot length | Say |
|---|---|---|
| `hello` | — | Hi, my name is Philip, and this is my project submission for the NEAR hackathon. It is called Handova. |
| `intro` | 13 s | In Lagos, renting a home often means paying a full year up front, plus agent fees, to people you have just met. Getting your caution deposit back depends on goodwill. Handova puts the rent in escrow on NEAR, until you move in. Here is how it works. |

## The story (four phones)

| File | Robot length | Who's on screen | Say |
|---|---|---|---|
| `ll1` | 7.5 s | Landlord | Ade is a landlord in Lagos. He creates a Handova account. The key is made on his phone. No wallet app, no gas. |
| `ll2` | 7.7 s | Landlord | He describes his flat in Pidgin. NEAR AI drafts the listing inside a secure enclave, and the server checks the enclave signature. |
| `ll3` | 4.8 s | Landlord | He checks every field and publishes it on NEAR. Handova's relayer pays the gas. |
| `mum` | 3.1 s | Mum | Mum lives in Lagos. She gets an account too. |
| `nr1` | 4.3 s | Nurse | Her daughter is a nurse in London. She finds the flat. No agent fee. |
| `nr2` | 6.9 s | Nurse | She pays for her mum. With USDC on NEAR, or from Base, Solana, or Ethereum through NEAR Intents. |
| `nr3` | 6.7 s | Nurse | This is a live NEAR Intents quote. On testnet the deposit is simulated, because Intents only runs on mainnet. |
| `nr4` | 7.1 s | Nurse | One transaction. Rent and caution are now locked in the escrow contract. Not with the landlord, and not with Handova. |
| `ll4` | 2.8 s | Landlord | Ade hands over the keys, and marks the handover. |
| `mm1` | 3.8 s | Mum | Mum confirms she has moved in. Only now is the landlord paid. |
| `mm2` | 7.9 s | Mum | Mum now holds a lease NFT. It holds her caution fee. Its picture and status are drawn on chain, and change with the lease. |
| `mm3` | 5.0 s | Mum | Handova speaks Yoruba, Hausa, Igbo and Pidgin, as well as English. |
| `ll5` | 2.5 s | Landlord | Ade withdraws his rent. The full amount. |
| `mm4` | 7.0 s | Mum | Months later, mum has to move to Abuja. Instead of losing her rent, she offers the rest of her lease to a new tenant. |
| `ll6` | 6.1 s | Landlord | Ade can see the tenant's rental passport. A lease never changes hands without him, so he agrees. |
| `to1` | 3.5 s | Tolu | Tolu needs a flat. He finds the lease on the home page. |
| `to2` | 6.8 s | Tolu | He takes it over in one payment. Mum is paid, and the lease NFT, with its caution right, moves to Tolu. |
| `to3` | 2.5 s | Tolu | At the end of his stay, Tolu moves out. |
| `ll7` | 2.8 s | Landlord | Ade claims part of the caution for a broken door. |
| `to4` | 8.2 s | Tolu | If they cannot agree, a council DAO on NEAR decides. Two of three votes, no single judge. Tolu offers to settle instead. |
| `ll8` | 3.3 s | Landlord | Ade agrees. The split is paid out by the contract. |
| `to5` | 7.4 s | Tolu | Tolu withdraws the rest of his caution. His finished lease now shows on his rental passport, for his next landlord to see. |

## Closing card

| File | Robot length | Say |
|---|---|---|
| `outro` | — | Handova solves one of the biggest housing problems in Lagos, for millions of renters. Rent without the agent, and without the fear. Thank you for watching. |

## Or let the YarnGPT API make all the clips

The lines live in `scripts/demo-voiceover.mjs`. With `YARNGPT_API_KEY` in `.env`:

```sh
bun scripts/voiceover-yarngpt.mjs --voices        # see the voice ids
bun scripts/voiceover-yarngpt.mjs voice <voiceId> # writes voice/intro.mp3 … voice/outro.mp3
```

## Turning the clips into the video

With the app running (`bun run server` and `bun run dev`), point both scripts at the folder of clips:

```sh
DEMO_AUDIO=voice node scripts/record-demo.mjs demo-out
DEMO_AUDIO=voice FFMPEG=/path/to/ffmpeg node scripts/compose-demo.mjs demo-out docs/media/handova-demo.mp4
```

The footage is recorded again so every scene lasts as long as its new clip. If a clip is missing, the script stops and names it.
