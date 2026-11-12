/**
 * Narration for the walkthrough video: one desktop browser, the real app, a person clicking through
 * it while talking. Each line is one clip (<id>.mp3/.wav/.m4a) and plays over the screen named in
 * `who` ('ada' is the tenant's browser, 'ade' the landlord's, 'sis' her sister's in London). Order here is the order in the video.
 */
export const PRESENTER = process.env.DEMO_PRESENTER ?? 'crazydevvy';

export const LINES = [
  { id: 'w01', who: 'ada', text: `I am ${PRESENTER}, and here is my submission for the NEAR hackathon: Handova.` },
  { id: 'w02', who: 'ada', text: 'In Lagos, renting a home usually means paying a full year of rent up front, plus an agent fee, to people you have just met. If the flat is not what you were shown, or the landlord disappears, that money is gone. And getting your caution deposit back at the end depends on goodwill.' },
  { id: 'w03', who: 'ada', text: 'Handova fixes this. Landlords list directly, with no agent. The rent waits in escrow on NEAR until the tenant has moved in, and the caution fee comes back at move-out, to whoever holds the lease NFT.' },
  { id: 'w04', who: 'ada', text: 'This is the home page. Every listing lives on NEAR testnet, priced in USDC and shown in Naira. You can save homes for later, see how many people booked a viewing, and use the app in Yoruba, Hausa, Igbo or Pidgin.' },
  { id: 'w05', who: 'ade', text: "Let's go through it from both sides. First, the landlord. Ade signs up with just a name. The key is made in his browser, there is no wallet app to install, and Handova pays the gas." },
  { id: 'w06', who: 'ade', text: 'He describes his flat in Pidgin, the way he would tell a friend, and NEAR AI drafts the listing. The answer comes with a signed receipt, which Handova checks.' },
  { id: 'w07', who: 'ade', text: 'He adds photos, checks the rent and the caution, and publishes the listing on NEAR.' },
  { id: 'w08', who: 'ada', text: 'Now the tenant. Ada is looking for a flat in Yaba. She signs up as a tenant, finds Ade\'s flat, and saves it.' },
  { id: 'w09', who: 'ada', text: 'Payment stays locked until she has seen the home. So she books a viewing, with her name and phone number.' },
  { id: 'w10', who: 'ade', text: 'Ade gets the request. He approves the time, and after the viewing, he agrees to rent to Ada.' },
  { id: 'w11', who: 'ada', text: 'Ada agrees too. Only now does payment open.' },
  { id: 'w12', who: 'sis', text: "Her sister in London pays it for her, from Base through NEAR Intents. She just types Ada's Handova name. This is a live Intents quote; on testnet the deposit is simulated." },
  { id: 'w13', who: 'sis', text: 'The rent and the caution are now locked in the escrow contract. Not with Ade, and not with Handova.' },
  { id: 'w14', who: 'ade', text: 'On moving day, Ade hands over the keys, and marks it in the app.' },
  { id: 'w15', who: 'ada', text: 'Ada confirms she has moved in. That releases the rent to Ade, and mints Ada a lease NFT.' },
  { id: 'w16', who: 'ada', text: 'This NFT is the right to the caution fee. Whoever holds it at move-out gets the caution back. Its picture and status are drawn on chain.' },
  { id: 'w17', who: 'ade', text: 'Ade withdraws his rent, in full.' },
  { id: 'w18', who: 'ada', text: 'A year later, Ada moves out.' },
  { id: 'w19', who: 'ade', text: 'Ade inspects the flat. It is fine, so he returns the caution. If there was damage, he could open a dispute, and a council DAO on NEAR would decide.' },
  { id: 'w20', who: 'ada', text: 'Ada withdraws her caution. Her finished lease goes into her rental passport, which she can show her next landlord.' },
  { id: 'w21', who: 'ada', text: 'That is Handova. Rent in Lagos without the agent, and without the fear. Escrow, lease NFTs, gas-free accounts, and payment from any chain, all on NEAR. Thank you for watching.' },
];
