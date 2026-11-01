/** Shapes returned by the Handova contract views. */
export type LeaseStatus = 'Pending' | 'Active' | 'Ending' | 'Disputed' | 'Closed' | 'Cancelled';

export interface Listing {
  id: number;
  landlord: string;
  rent: string;
  caution: string;
  term_months: number;
  property_ref: string;
  available: boolean;
  active_lease: number | null;
  created_at_ms: number;
  landlord_verified: boolean;
}

export interface Lease {
  id: number;
  listing_id: number;
  landlord: string;
  tenant: string;
  payer: string;
  rent: string;
  caution: string;
  term_months: number;
  status: LeaseStatus;
  paid_at_ms: number;
  handover_at_ms: number | null;
  move_in_dispute: string | null;
  move_in_dispute_at_ms: number | null;
  moved_in_at_ms: number | null;
  ends_at_ms: number | null;
  move_out_at_ms: number | null;
  dispute: { opened_at_ms: number; landlord_claim: string; reason: string; landlord_offer: string | null; tenant_offer: string | null } | null;
  closed_at_ms: number | null;
  caution_to_landlord: string;
  caution_to_holder: string;
  nft_holder: string | null;
}

export interface Timeouts {
  handover_claim_secs: number;
  cancel_after_secs: number;
  move_out_review_secs: number;
  dispute_secs: number;
}

export interface EscrowConfig {
  owner: string;
  arbiter: string;
  token: string;
  token_decimals: number;
  timeouts: Timeouts;
  total_held: string;
  listings: number;
  leases: number;
}
