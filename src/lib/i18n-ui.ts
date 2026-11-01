/**
 * Translations for the redesigned screens (browse, listing detail, landlord, leases, role picker).
 * Missing keys fall back to English.
 *
 * ⚠️ Yorùbá, Igbo and Hausa were machine-assisted and need review by native speakers before launch.
 *    Naija Pidgin is closer to production quality but should also be checked.
 */

import { useLang } from '@/lib/LangContext';
import type { LangCode } from '@/lib/i18n';

const en = {
  // Browse
  browse_title: 'Homes in Lagos, straight from landlords',
  browse_sub: 'no agent fees · rent held in escrow until you move in',
  homes: 'homes', home: 'home', sample: 'sample',
  filters: 'Filters', per_year_btn: 'Per year', per_month_btn: 'Per month',
  verified_only: 'Verified landlords only',
  samples_notice: "No homes are listed yet, so these are sample listings to show how Handova works. They can't be rented.",
  no_match: 'No homes match these filters', no_match_sub: 'Try another area, or clear the filters.', clear_filters: 'Clear filters',
  loading_listings: 'Loading listings…',
  // Card / trust
  verified_landlord_pill: 'Verified landlord', not_verified_pill: 'Landlord not verified', sample_pill: 'Sample listing',
  caution_escrow: 'caution · held in escrow',
  trust_verified_title: 'Verified landlord',
  trust_verified_body: 'Identity checked with an official ID and a live selfie on {date}. Recorded onchain — it can\'t be faked.',
  trust_unverified_title: 'Landlord not verified yet',
  trust_unverified_body: "Handova hasn't checked this landlord's identity. Inspect the property in person, and only pay through Handova escrow — never by bank transfer.",
  // Detail
  protected_title: 'How your money is protected',
  protect_1: 'You pay rent + caution fee into the Handova escrow — not to the landlord.',
  protect_2: "Rent is released to the landlord only after you confirm you've moved in.",
  protect_3: "Your caution fee comes back after you move out, unless there's a damage dispute.",
  rent_year: 'Rent (1 year)', caution_refundable: 'Caution fee (refundable)', agent_fee: 'Agent fee',
  pay_into_escrow: 'You pay into escrow', total_escrow: 'Total into escrow', inspect_rent: 'Inspect & rent', about_home: 'About this home',
  // Landlord
  your_properties: 'Your properties', landlord_sub: 'No agents. Tenants pay into escrow and you keep 100% of the rent.',
  list_on_whatsapp: 'List on WhatsApp', list_a_property: 'List a property',
  listed: 'Listed', rented: 'Rented', rent_per_year: 'Rent from tenants / yr', ready_withdraw: 'Ready to withdraw', withdraw: 'Withdraw',
  needs_attention: 'Needs your attention', identity_verified: 'Identity verified',
  verify_cta: 'Verify your identity — tenants trust verified landlords',
  tab_properties: 'Properties', tab_rented: 'Rented out', tab_whatsapp: 'List by WhatsApp', tab_insights: 'Insights',
  edit: 'Edit', delete: 'Delete', no_properties: 'No properties yet',
  // Leases
  your_leases: 'Your leases', leases_sub: 'Your money stays in escrow until each step is done. Nothing goes to the landlord before you move in.',
  step_paid: 'Paid', step_keys: 'Keys', step_moved_in: 'Moved in', step_moved_out: 'Moved out', step_settled: 'Settled',
  moved_in_btn: 'I have moved in', moving_out_btn: 'I am moving out', claim_caution: 'Claim my caution fee',
  lease_pdf: 'Lease PDF', request_repair: 'Request repair', report_problem: 'Report a problem', rate_landlord_btn: 'Rate landlord',
  no_leases: 'No leases yet',
  // Role picker
  how_use: 'How will you use Handova?',
  tenant_p1: 'Browse homes with photos and video', tenant_p2: 'Pay into escrow, not to a stranger', tenant_p3: 'Get your caution fee back',
  landlord_p1: 'List in minutes — or by WhatsApp voice note', landlord_p2: 'Get rent the day your tenant moves in', landlord_p3: 'No agent taking a cut',
};

export type UiKey = keyof typeof en;

const pcm: Partial<Record<UiKey, string>> = {
  browse_title: 'House for Lagos, straight from landlord',
  browse_sub: 'no agent fee · your rent dey escrow till you pack enter',
  homes: 'houses', home: 'house', sample: 'sample',
  filters: 'Filter', per_year_btn: 'Per year', per_month_btn: 'Per month',
  verified_only: 'Only verified landlord',
  samples_notice: 'No house don list yet, so na sample we dey show you make you see how Handova work. You no fit rent dem.',
  no_match: 'No house match wetin you choose', no_match_sub: 'Try another area, or clear the filter.', clear_filters: 'Clear filter',
  loading_listings: 'E dey load houses…',
  verified_landlord_pill: 'Verified landlord', not_verified_pill: 'Landlord never verify', sample_pill: 'Sample house',
  caution_escrow: 'caution · e dey escrow',
  trust_verified_title: 'Verified landlord',
  trust_verified_body: 'We check this landlord ID and selfie on {date}. E dey onchain — nobody fit fake am.',
  trust_unverified_title: 'Landlord never verify',
  trust_unverified_body: 'Handova never check who this landlord be. Go see the house with your eye, and pay only through Handova escrow — no do bank transfer.',
  protected_title: 'How we take protect your money',
  protect_1: 'You go pay rent + caution enter Handova escrow — no be to landlord hand.',
  protect_2: 'Landlord go collect rent only after you confirm say you don pack enter.',
  protect_3: 'Your caution go come back after you pack comot, unless dem talk say you spoil something.',
  rent_year: 'Rent (1 year)', caution_refundable: 'Caution (e go return)', agent_fee: 'Agent fee',
  pay_into_escrow: 'Wetin you go pay enter escrow', total_escrow: 'Total for escrow', inspect_rent: 'Inspect & rent', about_home: 'About this house',
  your_properties: 'Your houses', landlord_sub: 'No agent. Tenant dey pay enter escrow, you go collect your full rent.',
  list_on_whatsapp: 'List with WhatsApp', list_a_property: 'List house',
  listed: 'Listed', rented: 'Don rent', rent_per_year: 'Rent from tenant / year', ready_withdraw: 'Ready to withdraw', withdraw: 'Withdraw',
  needs_attention: 'E need your attention', identity_verified: 'You don verify',
  verify_cta: 'Verify yourself — tenant dey trust verified landlord',
  tab_properties: 'Houses', tab_rented: 'Don rent', tab_whatsapp: 'List with WhatsApp', tab_insights: 'Insights',
  edit: 'Edit', delete: 'Delete', no_properties: 'You never list any house',
  your_leases: 'Your houses wey you rent', leases_sub: 'Your money go stay for escrow till each step finish. Landlord no go collect anything before you pack enter.',
  step_paid: 'Don pay', step_keys: 'Key', step_moved_in: 'Don pack enter', step_moved_out: 'Don pack comot', step_settled: 'E don finish',
  moved_in_btn: 'I don pack enter', moving_out_btn: 'I wan pack comot', claim_caution: 'Collect my caution',
  lease_pdf: 'Lease PDF', request_repair: 'Report spoil thing', report_problem: 'Report wahala', rate_landlord_btn: 'Rate landlord',
  no_leases: 'You never rent any house',
  how_use: 'How you wan use Handova?',
  tenant_p1: 'See houses with picture and video', tenant_p2: 'Pay enter escrow, no be to stranger', tenant_p3: 'Collect your caution back',
  landlord_p1: 'List house sharp sharp — or send WhatsApp voice note', landlord_p2: 'Collect rent the day tenant pack enter', landlord_p3: 'No agent go chop your money',
};

const yo: Partial<Record<UiKey, string>> = {
  tab_rented: 'Ilé tí a ti yá',
  browse_title: 'Ilé ní Èkó, tààrà láti ọ̀dọ̀ onílé',
  browse_sub: 'kò sí owó agent · owó ilé wà ní escrow títí o fi wọlé',
  homes: 'ilé', home: 'ilé', sample: 'àpẹẹrẹ',
  filters: 'Àṣàyàn', per_year_btn: 'Lọ́dún', per_month_btn: 'Lóṣù',
  verified_only: 'Àwọn onílé tí a ti fìdí wọn múlẹ̀ nìkan',
  samples_notice: 'Kò tíì sí ilé kankan, nítorí náà àpẹẹrẹ ni àwọn wọ̀nyí láti fi bí Handova ṣe ń ṣiṣẹ́ hàn. A kò lè yá wọn.',
  no_match: 'Kò sí ilé tó bá àṣàyàn yìí mu', clear_filters: 'Pa àṣàyàn rẹ́',
  verified_landlord_pill: 'Onílé tí a fìdí rẹ̀ múlẹ̀', not_verified_pill: 'A kò tíì fìdí onílé múlẹ̀', sample_pill: 'Àpẹẹrẹ',
  caution_escrow: 'owó ìdánilójú · wà ní escrow',
  protected_title: 'Bí a ṣe ń dáàbò bo owó rẹ',
  rent_year: 'Owó ilé (ọdún 1)', caution_refundable: 'Owó ìdánilójú (a ó dá a padà)', agent_fee: 'Owó agent',
  inspect_rent: 'Wò ó kí o sì yá a',
  your_properties: 'Àwọn ilé rẹ', list_a_property: 'Fi ilé síta', list_on_whatsapp: 'Fi ilé síta lórí WhatsApp',
  withdraw: 'Gbà owó', needs_attention: 'Ó nílò àkíyèsí rẹ', identity_verified: 'A ti fìdí rẹ múlẹ̀',
  edit: 'Ṣàtúnṣe', delete: 'Pa á rẹ́',
  your_leases: 'Àwọn ilé tí o yá', step_paid: 'O ti sanwó', step_keys: 'Kọ́kọ́rọ́', step_moved_in: 'O ti wọlé', step_moved_out: 'O ti kúrò', step_settled: 'Ó parí',
  moved_in_btn: 'Mo ti wọlé', moving_out_btn: 'Mo fẹ́ kúrò', claim_caution: 'Gba owó ìdánilójú mi',
  request_repair: 'Béèrè àtúnṣe', rate_landlord_btn: 'Fún onílé ní máàkì',
  how_use: 'Báwo ni o ṣe fẹ́ lo Handova?',
};

const ig: Partial<Record<UiKey, string>> = {
  tab_rented: 'Ụlọ e gbazitere',
  browse_title: 'Ụlọ na Lagos, site n\'aka nwe ụlọ',
  browse_sub: 'enweghị ụgwọ agent · ego ụlọ nọ na escrow ruo mgbe ị banyere',
  filters: 'Nhọrọ', per_year_btn: 'Kwa afọ', per_month_btn: 'Kwa ọnwa',
  verified_only: 'Naanị ndị nwe ụlọ akwadoro',
  verified_landlord_pill: 'Onye nwe ụlọ akwadoro', not_verified_pill: 'Akwadobeghị onye nwe ụlọ', sample_pill: 'Ihe atụ',
  protected_title: 'Otu anyị si echekwa ego gị',
  rent_year: 'Ego ụlọ (afọ 1)', caution_refundable: 'Ego nchekwa (a ga-eweghachi ya)', agent_fee: 'Ụgwọ agent',
  inspect_rent: 'Lelee ma gbazite',
  your_properties: 'Ụlọ gị', list_a_property: 'Tinye ụlọ', withdraw: 'Wepụ ego', edit: 'Dezie', delete: 'Hichapụ',
  your_leases: 'Ụlọ ị gbaziri', moved_in_btn: 'Abanyela m', moving_out_btn: 'Ana m apụ', claim_caution: 'Nara ego nchekwa m',
  request_repair: 'Rịọ ndozi', how_use: 'Kedu ka ị ga-esi jiri Handova?',
};

const ha: Partial<Record<UiKey, string>> = {
  tab_rented: 'An bayar da haya',
  browse_title: 'Gidaje a Legas, kai tsaye daga masu gida',
  browse_sub: 'babu kuɗin dillali · kuɗin haya na ajiye a escrow har ka shiga',
  filters: 'Zaɓuɓɓuka', per_year_btn: 'A shekara', per_month_btn: 'A wata',
  verified_only: 'Masu gida da aka tabbatar kawai',
  verified_landlord_pill: 'Mai gida da aka tabbatar', not_verified_pill: 'Ba a tabbatar da mai gida ba', sample_pill: 'Misali',
  protected_title: 'Yadda muke kare kuɗinka',
  rent_year: 'Kuɗin haya (shekara 1)', caution_refundable: 'Kuɗin tsaro (za a mayar)', agent_fee: 'Kuɗin dillali',
  inspect_rent: 'Duba ka yi haya',
  your_properties: 'Gidajenka', list_a_property: 'Saka gida', withdraw: 'Cire kuɗi', edit: 'Gyara', delete: 'Share',
  your_leases: 'Gidajen da ka yi haya', moved_in_btn: 'Na shiga', moving_out_btn: 'Zan fita', claim_caution: 'Karɓi kuɗin tsarona',
  request_repair: 'Nemi gyara', how_use: 'Ta yaya za ka yi amfani da Handova?',
};

const UI: Record<LangCode, Partial<Record<UiKey, string>>> = { en, yo, pcm, ig, ha };

/** Translator for the redesigned screens: u('key', { date: '…' }). */
export function useUi() {
  const { lang } = useLang();
  return (key: UiKey, vars?: Record<string, string>) => {
    let s = UI[lang][key] ?? en[key];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  };
}
