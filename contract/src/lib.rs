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
//! Storage is paid by whoever adds it. A landlord's listing brings a NEAR deposit that covers the
//! listing and its next lease; each lease uses `LEASE_RESERVE_BYTES` of that credit, because its
//! record stays as history. Removing the listing returns what is left. So nobody can fill this
//! contract's storage with other people's money, and every open lease can finish (see
//! `assert_storage_room`). Tenants and payers never need NEAR.
//!
//! Money is pull-based: every payout is credited to a balance and leaves with `withdraw`.
//! Nobody — not the owner, not the arbiter — can move money outside these rules. The arbiter can
//! only split a disputed caution fee or decide a disputed move-in.

mod escrow;
mod events;
mod market;
mod nft;
mod svg;

#[cfg(test)]
mod tests;

use near_contract_standards::non_fungible_token::NonFungibleToken;
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, IterableSet, LookupMap};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

pub use escrow::{Dispute, Lease, LeaseStatus, PayMsg};
pub use market::{RentalRecord, Takeover};

pub const DAY_SECS: u64 = 86_400;
/// A lease month (365/12 days), so a 12-month lease ends after exactly 365 days.
pub const MONTH_SECS: u64 = 365 * DAY_SECS / 12;
/// Longest `property_ref`: the listing details as compact JSON (title, area, photo links) or a link.
pub const MAX_REF_LEN: usize = 1024;
pub const MAX_REASON_LEN: usize = 500;
pub const MAX_LISTINGS_PER_LANDLORD: u32 = 50;
/// Until the verifier marks a landlord ID-verified, they can list only a few homes.
pub const MAX_LISTINGS_UNVERIFIED: u32 = 3;
/// Storage kept back for each open lease: its record, the NFT, the balances it credits and two
/// dispute reasons, in the worst case. The sandbox test `worst_case_lease_fits_its_reserve` measures it.
pub const LEASE_RESERVE_BYTES: u64 = 4096;
/// Storage one listing can take in the worst case (longest details, a landlord's first listing).
/// The sandbox test `worst_case_listing_fits_its_deposit` measures it.
pub const LISTING_STORAGE_BYTES: u64 = 1904;

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
    NftApprovals,
    OpenLeases,
}

/// How long each waiting period lasts, in seconds. Fixed at deployment so the rules a tenant
/// paid under cannot change afterwards.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Timeouts {
    /// No handover this long after payment → tenant or payer can cancel for a full refund.
    pub cancel_after_secs: u64,
    /// Landlord's review window after move-out. Silence → the NFT holder claims the caution fee.
    pub move_out_review_secs: u64,
    /// A caution dispute nobody settles within this time goes back to the holder, less their offer.
    pub dispute_secs: u64,
}

impl Default for Timeouts {
    fn default() -> Self {
        Self {
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
    /// NEAR (yocto) this listing holds for storage: its own record plus its next lease's.
    /// Each new lease uses `LEASE_RESERVE_BYTES` of it; `remove_listing` returns the rest.
    pub storage_credit: U128,
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
    /// Leases not yet closed or cancelled. Each keeps `LEASE_RESERVE_BYTES` of storage back.
    pub open_leases: u64,
    /// NEAR beyond what current storage locks, in yocto.
    pub storage_spare: U128,
    /// What `create_listing` needs attached, in yocto: the listing's storage and its first lease's.
    pub listing_deposit: U128,
    /// What each further lease on a listing needs in its credit (`fund_listing`), in yocto.
    pub lease_storage: U128,
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
    /// Leases not yet closed or cancelled; the keeper reads only these.
    open_leases: IterableSet<u64>,
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
            open_leases: IterableSet::new(StorageKey::OpenLeases),
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
                Some(StorageKey::NftApprovals),
            ),
        }
    }

    // ---------- Listings ----------

    /// Put a home up for rent. Amounts are in USDC base units (1 USDC = 1_000_000). Attach at least
    /// `listing_deposit` (see `get_config`); anything more is kept as credit for later leases.
    #[payable]
    pub fn create_listing(
        &mut self,
        rent: U128,
        caution: U128,
        term_months: u16,
        property_ref: String,
    ) -> u64 {
        let deposit = env::attached_deposit().as_yoctonear();
        require!(
            deposit >= listing_deposit(),
            format!("Attach {} yoctoNEAR for this listing's storage. It comes back when you remove the listing", listing_deposit())
        );
        let landlord = env::predecessor_account_id();
        require!(rent.0 >= self.one_token(), "Rent must be at least 1 USDC");
        require!(term_months > 0 && term_months <= 120, "Term must be 1 to 120 months");
        require!(property_ref.len() <= MAX_REF_LEN, "property_ref is too long (max 1024 bytes)");
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
            storage_credit: U128(deposit),
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
            require!(p.len() <= MAX_REF_LEN, "property_ref is too long (max 1024 bytes)");
            listing.property_ref = p;
        }
        if let Some(a) = available {
            listing.available = a;
        }
        events::emit("listing_updated", near_sdk::serde_json::json!({ "listing_id": listing_id }));
    }

    /// Add storage credit to a listing so it can take its next lease. Anyone may pay.
    #[payable]
    pub fn fund_listing(&mut self, listing_id: u64) {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "Attach NEAR to add to this listing's storage credit");
        let listing = self.listings.get_mut(&listing_id).unwrap_or_else(|| env::panic_str("Listing not found"));
        listing.storage_credit = U128(listing.storage_credit.0 + amount);
        events::emit("listing_funded", near_sdk::serde_json::json!({ "listing_id": listing_id, "amount": U128(amount) }));
    }

    /// Take a home off Handova for good and get its storage credit back. Past leases stay as history.
    pub fn remove_listing(&mut self, listing_id: u64) -> U128 {
        let caller = env::predecessor_account_id();
        let listing = self.listings.get(&listing_id).unwrap_or_else(|| env::panic_str("Listing not found"));
        require!(listing.landlord == caller, "Only the landlord can remove this listing");
        require!(listing.active_lease.is_none(), "A lease is open on this home. Remove it after the lease ends");
        let refund = listing.storage_credit.0;
        self.listings.remove(&listing_id);
        let count = self.listing_counts.get(&caller).copied().unwrap_or(1);
        self.listing_counts.insert(caller.clone(), count.saturating_sub(1));
        events::emit("listing_removed", near_sdk::serde_json::json!({ "listing_id": listing_id, "refund": U128(refund) }));
        if refund > 0 {
            Promise::new(caller).transfer(NearToken::from_yoctonear(refund)).detach();
        }
        U128(refund)
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
            open_leases: self.open_leases.len() as u64,
            storage_spare: U128(self.storage_spare()),
            listing_deposit: U128(listing_deposit()),
            lease_storage: U128(lease_storage()),
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

    /// Leases not yet closed or cancelled, in the order they opened. The keeper reads these.
    pub fn get_open_leases(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Lease> {
        self.open_leases
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .filter_map(|id| self.leases.get(id))
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

/// What a new listing must attach: its own storage and its first lease's.
pub fn listing_deposit() -> u128 {
    (LISTING_STORAGE_BYTES + LEASE_RESERVE_BYTES) as u128 * env::storage_byte_cost().as_yoctonear()
}

/// The storage credit each new lease uses.
pub fn lease_storage() -> u128 {
    LEASE_RESERVE_BYTES as u128 * env::storage_byte_cost().as_yoctonear()
}

impl Contract {
    /// One whole token in base units (1 USDC = 1_000_000). Minimum rent, so near-free listings
    /// can't be used to fill contract storage with pay/cancel cycles.
    fn one_token(&self) -> u128 {
        10u128.pow(self.token_decimals as u32)
    }

    /// NEAR this account holds beyond what its current storage locks.
    fn storage_spare(&self) -> u128 {
        let locked = env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear();
        env::account_balance().as_yoctonear().saturating_sub(locked)
    }

    /// Called before storing anything optional. The room that open leases need is kept for them,
    /// so storage filling up can stop new listings but never a move-in, a dispute or a refund.
    pub(crate) fn assert_storage_room(&self) {
        let needed = (self.open_leases.len() as u128 + 1) * LEASE_RESERVE_BYTES as u128 * env::storage_byte_cost().as_yoctonear();
        require!(
            self.storage_spare() >= needed,
            "Handova is short of storage for new records. Open leases are safe. Anyone can send this account NEAR to free it"
        );
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
