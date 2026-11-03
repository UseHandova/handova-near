/**
 * Listing details live on-chain in `property_ref` as compact JSON (max 1 KB), so any NEAR
 * client can show a listing without Handova's servers.
 */
export interface ListingDetails {
  title: string;
  area: string;
  city: string;
  beds?: number;
  baths?: number;
  type?: string;
  photos: string[];
  /** Optional walk-through video (plays on hover on the home page). */
  video?: string;
  description?: string;
  amenities?: string[];
}

export function encodeDetails(d: ListingDetails): string {
  const compact = {
    v: 1, t: d.title.slice(0, 80), a: d.area.slice(0, 40), c: d.city.slice(0, 30),
    b: d.beds, ba: d.baths, k: d.type, p: d.photos.slice(0, 4), vi: d.video, am: d.amenities?.slice(0, 8), d: d.description,
  };
  let s = JSON.stringify(compact);
  // Trim the description until it fits the contract's 1 KB limit.
  while (new TextEncoder().encode(s).length > 1024 && compact.d) {
    compact.d = compact.d.slice(0, Math.max(0, compact.d.length - 40));
    s = JSON.stringify(compact);
  }
  return s;
}

export function decodeDetails(ref: string, id: number): ListingDetails {
  try {
    const j = JSON.parse(ref);
    if (j && j.v === 1) {
      return { title: j.t, area: j.a, city: j.c ?? 'Lagos', beds: j.b, baths: j.ba, type: j.k, photos: j.p ?? [], video: typeof j.vi === 'string' ? j.vi : undefined, amenities: j.am ?? [], description: j.d };
    }
  } catch { /* not JSON: a plain reference */ }
  return { title: ref ? ref.replace(/^demo:/, '').replace(/-/g, ' ') : `Home #${id}`, area: '', city: 'Lagos', photos: [] };
}
