//! Handova rent escrow on NEAR.
//!
//! One contract does three jobs:
//! - **Listings**: a landlord puts a home up with its rent and caution fee in USDC.
//! - **Escrow**: the tenant (or anyone paying for them, e.g. family abroad) pays rent + caution
//!   with one `ft_transfer_call`. The money waits here until the tenant confirms move-in.
//! - **Lease NFT (NEP-171)**: on move-in the rent goes to the landlord and the tenant gets a lease
//!   NFT. The caution fee stays in this contract and belongs to whoever holds that NFT: at move-out
//!   it is paid to the holder unless the landlord disputes. The NFT's metadata is live — it shows
//!   the lease status and how much caution it holds.
//!
//! Money is pull-based: every payout is credited to a balance and leaves with `withdraw`.
//! Nobody — not the owner, not the arbiter — can move money outside these rules. The arbiter can
//! only split a disputed caution fee or decide a disputed move-in.

mod escrow;
mod events;
mod nft;
mod svg;

#[cfg(test)]
mod tests;

use near_contract_standards::non_fungible_token::NonFungibleToken;
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

pub use escrow::{Dispute, Lease, LeaseStatus, PayMsg};

pub const DAY_SECS: u64 = 86_400;
/// A lease month (365/12 days), so a 12-month lease ends after exactly 365 days.
pub const MONTH_SECS: u64 = 365 * DAY_SECS / 12;
/// Longest `property_ref`: the listing details as compact JSON (title, area, photo links) or a link.
pub const MAX_REF_LEN: usize = 1024;
pub const MAX_REASON_LEN: usize = 500;
/// Stops one account from filling contract storage with listings (the contract pays storage).
pub const MAX_LISTINGS_PER_LANDLORD: u32 = 50;
/// Until the verifier marks a landlord ID-verified, they can list only a few homes.
pub const MAX_LISTINGS_UNVERIFIED: u32 = 3;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Listings,
    Leases,
    LeasesByAccount,
    Balances,
    Verified,
    ListingCounts,
    NftOwners,
    NftTokensPerOwner,
}

/// How long each waiting period lasts, in seconds. Fixed at deployment so the rules a tenant
/// paid under cannot change afterwards.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Timeouts {
    /// Landlord marked the handover and the tenant is silent this long → landlord can claim move-in.
    pub handover_claim_secs: u64,
    /// No handover this long after payment → tenant or payer can cancel for a full refund.
    pub cancel_after_secs: u64,
    /// Landlord's review window after move-out. Silence → the NFT holder claims the caution fee.
    pub move_out_review_secs: u64,
    /// A caution dispute nobody settles within this time splits 50/50.
    pub dispute_secs: u64,
}

impl Default for Timeouts {
    fn default() -> Self {
        Self {
            handover_claim_secs: 3 * DAY_SECS,
            cancel_after_secs: 7 * DAY_SECS,
            move_out_review_secs: 7 * DAY_SECS,
            dispute_secs: 7 * DAY_SECS,
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Listing {
    pub id: u64,
    pub landlord: AccountId,
    /// Rent for the whole term, in USDC base units (6 decimals).
    pub rent: U128,
    /// Refundable caution fee, in USDC base units.
    pub caution: U128,
    pub term_months: u16,
    /// Listing details: compact JSON (title, area, rooms, photo links) or a link to them.
    pub property_ref: String,
    /// The landlord is accepting payments for it.
    pub available: bool,
    /// The lease currently using this home, if any. A home has one lease at a time.
    pub active_lease: Option<u64>,
    pub created_at_ms: u64,
}

#[near(serializers = [json])]
pub struct ListingView {
    #[serde(flatten)]
    pub listing: Listing,
    pub landlord_verified: bool,
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub owner: AccountId,
    pub verifier: AccountId,
    pub arbiter: AccountId,
    pub token: AccountId,
    pub token_decimals: u8,
    pub timeouts: Timeouts,
    pub total_held: U128,
    pub listings: u64,
    pub leases: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    /// Records verified landlords (Handova's server key after an ID check).
    verifier: AccountId,
    /// Decides disputes. Can be a Sputnik DAO account.
    arbiter: AccountId,
    /// The one fungible token accepted (USDC).
    token: AccountId,
    token_decimals: u8,
    timeouts: Timeouts,

    listings: IterableMap<u64, Listing>,
    next_listing_id: u64,
    listing_counts: LookupMap<AccountId, u32>,
    leases: IterableMap<u64, Lease>,
    next_lease_id: u64,
    /// Lease ids for every account involved (tenant, landlord, payer).
    leases_by_account: LookupMap<AccountId, Vec<u64>>,

    /// Money people can withdraw now.
    balances: LookupMap<AccountId, u128>,
    /// Every token unit this contract owes someone: escrowed payments, caution fees, balances.
    /// The contract's USDC balance is always at least this.
    total_held: u128,

    /// Verified landlords → time of verification (ms).
    verified: LookupMap<AccountId, u64>,

    nft: NonFungibleToken,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner: AccountId,
        verifier: AccountId,
        arbiter: AccountId,
        token: AccountId,
        token_decimals: Option<u8>,
        timeouts: Option<Timeouts>,
    ) -> Self {
        Self {
            owner,
            verifier,
            arbiter,
            token,
            token_decimals: token_decimals.unwrap_or(6),
            timeouts: timeouts.unwrap_or_default(),
            listings: IterableMap::new(StorageKey::Listings),
            next_listing_id: 1,
            listing_counts: LookupMap::new(StorageKey::ListingCounts),
            leases: IterableMap::new(StorageKey::Leases),
            next_lease_id: 1,
            leases_by_account: LookupMap::new(StorageKey::LeasesByAccount),
            balances: LookupMap::new(StorageKey::Balances),
            total_held: 0,
            verified: LookupMap::new(StorageKey::Verified),
            // Token metadata is computed live from the lease (see nft.rs), so none is stored.
            nft: NonFungibleToken::new(
                StorageKey::NftOwners,
                env::current_account_id(),
                None::<StorageKey>,
                Some(StorageKey::NftTokensPerOwner),
                None::<StorageKey>,
            ),
        }
    }

    // ---------- Listings ----------

    /// Put a home up for rent. Amounts are in USDC base units (1 USDC = 1_000_000).
    pub fn create_listing(
        &mut self,
        rent: U128,
        caution: U128,
        term_months: u16,
        property_ref: String,
    ) -> u64 {
        let landlord = env::predecessor_account_id();
        require!(rent.0 >= self.one_token(), "Rent must be at least 1 USDC");
        require!(term_months > 0 && term_months <= 120, "Term must be 1 to 120 months");
        require!(property_ref.len() <= MAX_REF_LEN, "property_ref is too long (max 1024 characters)");
        let count = self.listing_counts.get(&landlord).copied().unwrap_or(0);
        require!(count < MAX_LISTINGS_PER_LANDLORD, "You have reached the limit of 50 listings");
        require!(
            count < MAX_LISTINGS_UNVERIFIED || self.verified.contains_key(&landlord),
            "Unverified landlords can list up to 3 homes. Verify your ID to list more"
        );
        self.listing_counts.insert(landlord.clone(), count + 1);

        let id = self.next_listing_id;
        self.next_listing_id += 1;
        let listing = Listing {
            id,
            landlord: landlord.clone(),
            rent,
            caution,
            term_months,
            property_ref,
            available: true,
            active_lease: None,
            created_at_ms: env::block_timestamp_ms(),
        };
        events::emit(
            "listing_created",
            near_sdk::serde_json::json!({
                "listing_id": id, "landlord": landlord, "rent": rent, "caution": caution,
                "term_months": term_months,
            }),
        );
        self.listings.insert(id, listing);
        id
    }

    /// Change a listing. Prices and term can only change while no lease is using the home.
    pub fn update_listing(
        &mut self,
        listing_id: u64,
        rent: Option<U128>,
        caution: Option<U128>,
        term_months: Option<u16>,
        property_ref: Option<String>,
        available: Option<bool>,
    ) {
        let caller = env::predecessor_account_id();
        let one = self.one_token();
        let listing = self.listings.get_mut(&listing_id).unwrap_or_else(|| env::panic_str("Listing not found"));
        require!(listing.landlord == caller, "Only the landlord can change this listing");
        if rent.is_some() || caution.is_some() || term_months.is_some() {
            require!(listing.active_lease.is_none(), "Prices can't change while a lease is open on this home");
        }
        if let Some(r) = rent {
            require!(r.0 >= one, "Rent must be at least 1 USDC");
            listing.rent = r;
        }
        if let Some(c) = caution {
            listing.caution = c;
        }
        if let Some(t) = term_months {
            require!(t > 0 && t <= 120, "Term must be 1 to 120 months");
            listing.term_months = t;
        }
        if let Some(p) = property_ref {
            require!(p.len() <= MAX_REF_LEN, "property_ref is too long (max 1024 characters)");
            listing.property_ref = p;
        }
        if let Some(a) = available {
            listing.available = a;
        }
        events::emit("listing_updated", near_sdk::serde_json::json!({ "listing_id": listing_id }));
    }

    // ---------- Admin (no access to anyone's money) ----------

    /// Mark a landlord as ID-verified (or remove the badge). Verifier only.
    pub fn set_verified(&mut self, account_id: AccountId, verified: bool) {
        require!(env::predecessor_account_id() == self.verifier, "Only the verifier can do this");
        if verified {
            self.verified.insert(account_id.clone(), env::block_timestamp_ms());
        } else {
            self.verified.remove(&account_id);
        }
        events::emit(
            "landlord_verified",
            near_sdk::serde_json::json!({ "account_id": account_id, "verified": verified }),
        );
    }

    pub fn set_verifier(&mut self, verifier: AccountId) {
        self.assert_owner();
        self.verifier = verifier;
    }

    pub fn set_arbiter(&mut self, arbiter: AccountId) {
        self.assert_owner();
        self.arbiter = arbiter;
    }

    pub fn set_owner(&mut self, owner: AccountId) {
        self.assert_owner();
        self.owner = owner;
    }

    // ---------- Views ----------

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner.clone(),
            verifier: self.verifier.clone(),
            arbiter: self.arbiter.clone(),
            token: self.token.clone(),
            token_decimals: self.token_decimals,
            timeouts: self.timeouts.clone(),
            total_held: U128(self.total_held),
            listings: self.next_listing_id - 1,
            leases: self.next_lease_id - 1,
        }
    }

    pub fn get_listing(&self, listing_id: u64) -> Option<ListingView> {
        self.listings.get(&listing_id).map(|l| self.listing_view(l))
    }

    /// Listings in id order. `only_open` hides homes that are taken or paused.
    pub fn get_listings(&self, from_index: Option<u64>, limit: Option<u64>, only_open: Option<bool>) -> Vec<ListingView> {
        let only_open = only_open.unwrap_or(false);
        self.listings
            .values()
            .filter(|l| !only_open || (l.available && l.active_lease.is_none()))
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .map(|l| self.listing_view(l))
            .collect()
    }

    pub fn get_lease(&self, lease_id: u64) -> Option<Lease> {
        self.leases.get(&lease_id).map(|l| self.with_holder(l))
    }

    /// Leases in id order. Used by the keeper that triggers timeouts nobody acted on.
    pub fn get_leases(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Lease> {
        self.leases
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .map(|l| self.with_holder(l))
            .collect()
    }

    /// Every lease the account is part of (as tenant, landlord or payer), newest first.
    pub fn get_leases_for(&self, account_id: AccountId) -> Vec<Lease> {
        self.leases_by_account
            .get(&account_id)
            .map(|ids| {
                let mut seen = std::collections::HashSet::new();
                ids.iter().rev().filter(|id| seen.insert(**id)).filter_map(|id| self.leases.get(id)).map(|l| self.with_holder(l)).collect()
            })
            .unwrap_or_default()
    }

    pub fn balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    pub fn is_verified(&self, account_id: AccountId) -> bool {
        self.verified.contains_key(&account_id)
    }
}

impl Contract {
    /// One whole token in base units (1 USDC = 1_000_000). Minimum rent, so near-free listings
    /// can't be used to fill contract storage with pay/cancel cycles.
    fn one_token(&self) -> u128 {
        10u128.pow(self.token_decimals as u32)
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can do this");
    }

    fn listing_view(&self, l: &Listing) -> ListingView {
        ListingView { listing: l.clone(), landlord_verified: self.verified.contains_key(&l.landlord) }
    }

    /// Fill in who holds the lease NFT right now (the person the caution fee goes to).
    fn with_holder(&self, l: &Lease) -> Lease {
        let mut l = l.clone();
        l.nft_holder = self.nft.owner_by_id.get(&l.id.to_string());
        l
    }

    pub(crate) fn credit(&mut self, account: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let b = self.balances.get(account).copied().unwrap_or(0);
        self.balances.insert(account.clone(), b + amount);
    }

    pub(crate) fn index_lease(&mut self, account: &AccountId, lease_id: u64) {
        let ids = self.leases_by_account.entry(account.clone()).or_default();
        if ids.last() != Some(&lease_id) {
            ids.push(lease_id);
        }
    }
}
