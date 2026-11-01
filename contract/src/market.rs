//! The lease as a tradable, reputation-carrying asset.
//!
//! - **Takeover:** a tenant who wants to leave early offers their lease (the home for the rest of
//!   the term, and the caution right) for a USDC price. The landlord consents. The next tenant pays
//!   with one `ft_transfer_call` (`{"take_over": <lease id>}`): the seller is paid, the lease NFT
//!   and its caution right move to the buyer, and the buyer becomes the tenant.
//! - **Rental passport:** finished lease NFTs are a tenant's record — how many leases they finished
//!   and whether their caution came back in full. Landlords can read it before handing over keys.

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId};

use crate::{events, Contract, ContractExt, LeaseStatus};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Takeover {
    /// What the next tenant pays the current holder, in USDC base units.
    pub price: U128,
    pub landlord_consent: bool,
    pub offered_at_ms: u64,
}

/// `msg` of `ft_transfer_call` when buying a lease takeover.
#[near(serializers = [json])]
pub struct TakeoverMsg {
    pub take_over: u64,
}

#[near(serializers = [json])]
#[derive(Default)]
pub struct RentalRecord {
    pub account_id: Option<AccountId>,
    /// Leases where this account held the NFT when the caution was paid out.
    pub leases_completed: u32,
    pub caution_returned_in_full: u32,
    pub caution_partly_kept: u32,
    pub caution_returned_total: U128,
    pub caution_kept_total: U128,
    /// Leases this account moved into as the tenant.
    pub leases_moved_in: u32,
    pub months_rented: u32,
    pub rent_paid_total: U128,
    pub active_leases: u32,
    pub first_move_in_ms: Option<u64>,
}

#[near]
impl Contract {
    /// Lease holder: offer the lease to a new tenant for `price` (USDC base units). Replaces any
    /// earlier offer and needs the landlord's consent again.
    pub fn offer_takeover(&mut self, lease_id: u64, price: U128) {
        let holder = self.holder(lease_id);
        require!(env::predecessor_account_id() == holder, "Only the lease holder can offer a takeover");
        let lease = self.leases.get_mut(&lease_id).unwrap_or_else(|| env::panic_str("Lease not found"));
        require!(lease.status == LeaseStatus::Active, "Only an active lease can be handed over");
        lease.takeover = Some(Takeover { price, landlord_consent: false, offered_at_ms: env::block_timestamp_ms() });
        events::emit("takeover_offered", json!({ "lease_id": lease_id, "holder": holder, "price": price }));
    }

    pub fn cancel_takeover(&mut self, lease_id: u64) {
        let holder = self.holder(lease_id);
        require!(env::predecessor_account_id() == holder, "Only the lease holder can cancel the offer");
        let lease = self.leases.get_mut(&lease_id).unwrap_or_else(|| env::panic_str("Lease not found"));
        require!(lease.takeover.take().is_some(), "There is no offer to cancel");
        events::emit("takeover_cancelled", json!({ "lease_id": lease_id }));
    }

    /// Landlord: agree that the lease may pass to whoever pays the offered price.
    pub fn consent_takeover(&mut self, lease_id: u64) {
        let lease = self.leases.get_mut(&lease_id).unwrap_or_else(|| env::panic_str("Lease not found"));
        require!(env::predecessor_account_id() == lease.landlord, "Only the landlord can consent");
        let t = lease.takeover.as_mut().unwrap_or_else(|| env::panic_str("There is no takeover offer"));
        t.landlord_consent = true;
        events::emit("takeover_consented", json!({ "lease_id": lease_id }));
    }

    /// The account's rental passport, computed from the leases it took part in.
    pub fn rental_record(&self, account_id: AccountId) -> RentalRecord {
        let mut r = RentalRecord { account_id: Some(account_id.clone()), ..Default::default() };
        let (mut returned, mut kept, mut rent) = (0u128, 0u128, 0u128);
        let ids = self.leases_by_account.get(&account_id).cloned().unwrap_or_default();
        let mut seen = std::collections::HashSet::new();
        for id in ids.into_iter().filter(|id| seen.insert(*id)) {
            let Some(l) = self.leases.get(&id) else { continue };
            if l.status == LeaseStatus::Closed && l.closed_holder.as_ref() == Some(&account_id) {
                r.leases_completed += 1;
                returned += l.caution_to_holder.0;
                kept += l.caution_to_landlord.0;
                if l.caution_to_landlord.0 == 0 { r.caution_returned_in_full += 1 } else { r.caution_partly_kept += 1 }
            }
            if l.tenant == account_id {
                if let Some(at) = l.moved_in_at_ms {
                    r.leases_moved_in += 1;
                    r.months_rented += l.term_months as u32;
                    rent += l.rent.0;
                    r.first_move_in_ms = Some(r.first_move_in_ms.map_or(at, |f| f.min(at)));
                }
            }
            if matches!(l.status, LeaseStatus::Active | LeaseStatus::Ending | LeaseStatus::Disputed) && self.holder(id) == account_id {
                r.active_leases += 1;
            }
        }
        r.caution_returned_total = U128(returned);
        r.caution_kept_total = U128(kept);
        r.rent_paid_total = U128(rent);
        r
    }
}

impl Contract {
    /// Pay the holder, move the NFT to the buyer, make the buyer the tenant. Returns the unused amount.
    pub(crate) fn buy_takeover(&mut self, buyer: AccountId, amount: u128, lease_id: u64) -> u128 {
        let holder = self.holder(lease_id);
        let lease = self.leases.get_mut(&lease_id).unwrap_or_else(|| env::panic_str("Lease not found"));
        require!(lease.status == LeaseStatus::Active, "This lease is no longer active");
        let t = lease.takeover.clone().unwrap_or_else(|| env::panic_str("This lease is not offered for takeover"));
        require!(t.landlord_consent, "The landlord hasn't agreed to this takeover yet");
        require!(buyer != holder, "You already hold this lease");
        require!(buyer != lease.landlord, "The landlord can't take over their own lease");
        require!(amount >= t.price.0, format!("Payment too small: this takeover costs {}", t.price.0));
        lease.tenant = buyer.clone();
        lease.takeover = None;

        self.credit(&holder, t.price.0);
        self.total_held += t.price.0;
        // Same path as nft_transfer by the owner: clears approvals and emits the NEP-171 nft_transfer event.
        self.nft.internal_transfer(&holder, &buyer, &lease_id.to_string(), None, Some("Handova lease takeover".into()));
        self.index_lease(&buyer, lease_id);
        events::emit("lease_taken_over", json!({ "lease_id": lease_id, "from": holder, "to": buyer, "price": t.price }));
        amount - t.price.0
    }
}
