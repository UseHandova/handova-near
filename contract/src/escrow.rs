//! Lease lifecycle: pay → (handover) → move-in → move-out → review/dispute → closed.

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, Promise, PromiseOrValue};

use crate::{events, Contract, ContractExt, MAX_REASON_LEN, MONTH_SECS};

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_ON_WITHDRAW: Gas = Gas::from_tgas(10);

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LeaseStatus {
    /// Paid; rent and caution wait in escrow for move-in.
    Pending,
    /// Tenant moved in; rent paid to the landlord; caution held by the lease NFT.
    Active,
    /// Tenant moved out; landlord is reviewing the home.
    Ending,
    /// Landlord disputed the caution refund.
    Disputed,
    /// Finished; caution paid out.
    Closed,
    /// Cancelled before move-in; payer refunded.
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Dispute {
    pub opened_at_ms: u64,
    /// How much of the caution the landlord asks to keep.
    pub landlord_claim: U128,
    pub reason: String,
    /// Latest split each side proposed (landlord's share). Equal offers settle the dispute.
    pub landlord_offer: Option<U128>,
    pub tenant_offer: Option<U128>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Lease {
    pub id: u64,
    pub listing_id: u64,
    pub landlord: AccountId,
    /// Who lives there. Confirms move-in; receives the lease NFT.
    pub tenant: AccountId,
    /// Who sent the money (can be someone else, e.g. family abroad). Refunded if cancelled.
    pub payer: AccountId,
    pub rent: U128,
    pub caution: U128,
    pub term_months: u16,
    pub status: LeaseStatus,
    pub paid_at_ms: u64,
    pub handover_at_ms: Option<u64>,
    /// Tenant says the landlord marked a handover that didn't happen. Blocks the landlord's claim.
    pub move_in_dispute: Option<String>,
    pub move_in_dispute_at_ms: Option<u64>,
    pub moved_in_at_ms: Option<u64>,
    pub ends_at_ms: Option<u64>,
    pub move_out_at_ms: Option<u64>,
    pub dispute: Option<Dispute>,
    pub closed_at_ms: Option<u64>,
    /// At close: how the caution was split.
    pub caution_to_landlord: U128,
    pub caution_to_holder: U128,
    /// Current lease NFT holder. Filled in by views; not stored.
    #[borsh(skip)]
    pub nft_holder: Option<AccountId>,
}

/// The `msg` of `ft_transfer_call` when paying for a home.
#[near(serializers = [json])]
pub struct PayMsg {
    pub listing_id: u64,
    /// Who will live there. Defaults to the sender. Set it to pay for someone else.
    pub tenant: Option<AccountId>,
}

#[near]
impl FungibleTokenReceiver for Contract {
    /// Pay rent + caution for a listing in one transaction:
    /// `usdc.ft_transfer_call({receiver_id: <this>, amount, msg: '{"listing_id":1}'})`.
    /// Anything above rent + caution is sent back. If the payment can't be accepted the call
    /// fails and the token contract refunds the whole amount.
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token, "Only the configured USDC token is accepted");
        let req: PayMsg = near_sdk::serde_json::from_str(&msg)
            .unwrap_or_else(|_| env::panic_str(r#"Invalid msg. Expected {"listing_id": <id>, "tenant": "<optional account>"}"#));
        let tenant = req.tenant.unwrap_or_else(|| sender_id.clone());

        let listing = self.listings.get_mut(&req.listing_id).unwrap_or_else(|| env::panic_str("Listing not found"));
        require!(listing.available, "This home is not taking payments right now");
        require!(listing.active_lease.is_none(), "This home is already taken");
        require!(tenant != listing.landlord, "The landlord can't rent their own home");
        let total = listing.rent.0 + listing.caution.0;
        require!(amount.0 >= total, format!("Payment too small: this home needs {} (rent + caution)", total));

        let lease_id = self.next_lease_id;
        self.next_lease_id += 1;
        listing.active_lease = Some(lease_id);
        let lease = Lease {
            id: lease_id,
            listing_id: listing.id,
            landlord: listing.landlord.clone(),
            tenant: tenant.clone(),
            payer: sender_id.clone(),
            rent: listing.rent,
            caution: listing.caution,
            term_months: listing.term_months,
            status: LeaseStatus::Pending,
            paid_at_ms: env::block_timestamp_ms(),
            handover_at_ms: None,
            move_in_dispute: None,
            move_in_dispute_at_ms: None,
            moved_in_at_ms: None,
            ends_at_ms: None,
            move_out_at_ms: None,
            dispute: None,
            closed_at_ms: None,
            caution_to_landlord: U128(0),
            caution_to_holder: U128(0),
            nft_holder: None,
        };
        let landlord = lease.landlord.clone();
        self.leases.insert(lease_id, lease);
        self.total_held += total;
        self.index_lease(&tenant, lease_id);
        self.index_lease(&landlord, lease_id);
        self.index_lease(&sender_id, lease_id);

        events::emit(
            "lease_paid",
            json!({
                "lease_id": lease_id, "listing_id": req.listing_id, "tenant": tenant, "payer": sender_id,
                "landlord": landlord, "amount": U128(total),
            }),
        );
        PromiseOrValue::Value(U128(amount.0 - total))
    }
}

#[near]
impl Contract {
    /// Landlord: "I handed over the keys." If the tenant stays silent past the handover window,
    /// the landlord can claim move-in.
    pub fn mark_handover(&mut self, lease_id: u64) {
        let lease = self.lease_mut(lease_id);
        require!(env::predecessor_account_id() == lease.landlord, "Only the landlord can mark the handover");
        require!(lease.status == LeaseStatus::Pending, "Handover is only for a lease waiting for move-in");
        require!(lease.handover_at_ms.is_none(), "Handover is already marked");
        lease.handover_at_ms = Some(env::block_timestamp_ms());
        events::emit("handover_marked", json!({ "lease_id": lease_id }));
    }

    /// Tenant: "I moved in." Pays the rent to the landlord and mints the lease NFT holding the caution.
    pub fn confirm_move_in(&mut self, lease_id: u64) {
        let lease = self.lease_ref(lease_id);
        require!(env::predecessor_account_id() == lease.tenant, "Only the tenant can confirm move-in");
        require!(lease.status == LeaseStatus::Pending, "This lease is not waiting for move-in");
        self.activate(lease_id);
    }

    /// Anyone, after an ID-verified landlord marked the handover and the tenant stayed silent for
    /// the handover window (3 days). Same result as the tenant confirming. Unverified landlords
    /// always need the tenant's confirmation, so a fake listing can't collect rent by silence.
    pub fn claim_move_in(&mut self, lease_id: u64) {
        let lease = self.lease_ref(lease_id);
        require!(
            self.verified.contains_key(&lease.landlord),
            "Only ID-verified landlords can claim move-in without the tenant. Ask the tenant to confirm"
        );
        require!(lease.status == LeaseStatus::Pending, "This lease is not waiting for move-in");
        let handover = lease.handover_at_ms.unwrap_or_else(|| env::panic_str("The landlord hasn't marked the handover"));
        require!(lease.move_in_dispute.is_none(), "The tenant disputed the handover; the arbiter decides");
        require!(
            env::block_timestamp_ms() >= handover + self.timeouts.handover_claim_secs * 1000,
            "The tenant still has time to respond to the handover"
        );
        self.activate(lease_id);
    }

    /// Tenant: "The landlord marked a handover but I don't have the keys." Stops the automatic
    /// claim. Ends when the tenant confirms, the landlord cancels, or the arbiter decides.
    pub fn dispute_move_in(&mut self, lease_id: u64, reason: String) {
        require!(reason.len() <= MAX_REASON_LEN, "Reason is too long (max 500 characters)");
        let lease = self.lease_mut(lease_id);
        require!(env::predecessor_account_id() == lease.tenant, "Only the tenant can dispute the handover");
        require!(lease.status == LeaseStatus::Pending, "This lease is not waiting for move-in");
        require!(lease.handover_at_ms.is_some(), "There is no handover to dispute");
        lease.move_in_dispute = Some(reason.clone());
        lease.move_in_dispute_at_ms = Some(env::block_timestamp_ms());
        events::emit("move_in_disputed", json!({ "lease_id": lease_id, "reason": reason }));
    }

    /// Arbiter: decide a disputed handover. `moved_in = true` pays the landlord as if the tenant
    /// confirmed; `false` refunds the payer in full.
    pub fn resolve_move_in(&mut self, lease_id: u64, moved_in: bool) {
        require!(env::predecessor_account_id() == self.arbiter, "Only the arbiter can decide");
        let lease = self.lease_ref(lease_id);
        require!(lease.status == LeaseStatus::Pending, "This lease is not waiting for move-in");
        require!(lease.move_in_dispute.is_some(), "There is no handover dispute on this lease");
        if moved_in {
            self.activate(lease_id);
        } else {
            self.cancel(lease_id, "arbiter");
        }
    }

    /// Anyone, if the arbiter hasn't decided a disputed handover within the dispute window:
    /// the payer is refunded in full. Money can never wait on the arbiter forever.
    pub fn settle_move_in_timeout(&mut self, lease_id: u64) {
        let lease = self.lease_ref(lease_id);
        require!(lease.status == LeaseStatus::Pending, "This lease is not waiting for move-in");
        let at = lease.move_in_dispute_at_ms.unwrap_or_else(|| env::panic_str("There is no handover dispute on this lease"));
        require!(env::block_timestamp_ms() >= at + self.timeouts.dispute_secs * 1000, "The arbiter still has time to decide");
        self.cancel(lease_id, "dispute_timeout");
    }

    /// Cancel before move-in with a full refund to the payer.
    /// - The landlord can decline any time before move-in.
    /// - The tenant or payer can cancel if no handover happened within the cancel window (7 days).
    pub fn cancel_lease(&mut self, lease_id: u64) {
        let caller = env::predecessor_account_id();
        let lease = self.lease_ref(lease_id);
        require!(lease.status == LeaseStatus::Pending, "Only a lease waiting for move-in can be cancelled");
        if caller == lease.landlord {
            self.cancel(lease_id, "landlord");
            return;
        }
        require!(caller == lease.tenant || caller == lease.payer, "Only the tenant, payer or landlord can cancel");
        require!(lease.handover_at_ms.is_none(), "The landlord marked the handover; confirm move-in or dispute it");
        require!(
            env::block_timestamp_ms() >= lease.paid_at_ms + self.timeouts.cancel_after_secs * 1000,
            "The landlord still has time to hand over the home"
        );
        self.cancel(lease_id, "tenant");
    }

    /// Start move-out. The NFT holder can do it any time; the landlord only after the term ended.
    pub fn move_out(&mut self, lease_id: u64) {
        let caller = env::predecessor_account_id();
        let holder = self.holder(lease_id);
        let now = env::block_timestamp_ms();
        let lease = self.lease_mut(lease_id);
        require!(lease.status == LeaseStatus::Active, "Only an active lease can move out");
        if caller != holder {
            require!(caller == lease.landlord, "Only the lease holder or landlord can start move-out");
            require!(now >= lease.ends_at_ms.unwrap_or(u64::MAX), "The landlord can start move-out only after the term ends");
        }
        lease.status = LeaseStatus::Ending;
        lease.move_out_at_ms = Some(now);
        events::emit("move_out_started", json!({ "lease_id": lease_id, "by": caller }));
    }

    /// Landlord: the home is fine — return the whole caution fee to the NFT holder.
    pub fn approve_move_out(&mut self, lease_id: u64) {
        let lease = self.lease_ref(lease_id);
        require!(env::predecessor_account_id() == lease.landlord, "Only the landlord can approve move-out");
        require!(lease.status == LeaseStatus::Ending, "This lease is not in move-out review");
        self.close(lease_id, 0, "approved");
    }

    /// Landlord: keep part (or all) of the caution for damage. Only during the review window.
    pub fn dispute_caution(&mut self, lease_id: u64, landlord_claim: U128, reason: String) {
        require!(reason.len() <= MAX_REASON_LEN, "Reason is too long (max 500 characters)");
        let review = self.timeouts.move_out_review_secs * 1000;
        let now = env::block_timestamp_ms();
        let lease = self.lease_mut(lease_id);
        require!(env::predecessor_account_id() == lease.landlord, "Only the landlord can dispute the caution");
        require!(lease.status == LeaseStatus::Ending, "This lease is not in move-out review");
        require!(now < lease.move_out_at_ms.unwrap() + review, "The review window has ended");
        require!(landlord_claim.0 > 0 && landlord_claim.0 <= lease.caution.0, "Claim must be between 1 and the caution fee");
        lease.status = LeaseStatus::Disputed;
        lease.dispute = Some(Dispute {
            opened_at_ms: now,
            landlord_claim,
            reason: reason.clone(),
            landlord_offer: Some(landlord_claim),
            tenant_offer: None,
        });
        events::emit("caution_disputed", json!({ "lease_id": lease_id, "landlord_claim": landlord_claim, "reason": reason }));
    }

    /// Anyone, after the review window passed with no answer from the landlord: the NFT holder
    /// gets the whole caution fee back.
    pub fn claim_caution(&mut self, lease_id: u64) {
        let lease = self.lease_ref(lease_id);
        require!(lease.status == LeaseStatus::Ending, "This lease is not in move-out review");
        require!(
            env::block_timestamp_ms() >= lease.move_out_at_ms.unwrap() + self.timeouts.move_out_review_secs * 1000,
            "The landlord's review window is still open"
        );
        self.close(lease_id, 0, "review_timeout");
    }

    /// Landlord or NFT holder: propose how much of the caution the landlord keeps. When both
    /// sides propose the same amount, the dispute settles.
    pub fn propose_split(&mut self, lease_id: u64, landlord_amount: U128) {
        let caller = env::predecessor_account_id();
        let holder = self.holder(lease_id);
        let lease = self.lease_mut(lease_id);
        require!(lease.status == LeaseStatus::Disputed, "This lease has no open dispute");
        require!(landlord_amount.0 <= lease.caution.0, "Amount can't be more than the caution fee");
        let is_landlord = caller == lease.landlord;
        require!(is_landlord || caller == holder, "Only the landlord or lease holder can propose a split");
        let d = lease.dispute.as_mut().unwrap();
        if is_landlord {
            d.landlord_offer = Some(landlord_amount);
        } else {
            d.tenant_offer = Some(landlord_amount);
        }
        let agreed = d.landlord_offer.is_some() && d.landlord_offer == d.tenant_offer;
        events::emit("split_proposed", json!({ "lease_id": lease_id, "by": caller, "landlord_amount": landlord_amount }));
        if agreed {
            self.close(lease_id, landlord_amount.0, "agreed");
        }
    }

    /// Arbiter: decide how much of the caution the landlord keeps; the rest goes to the holder.
    pub fn resolve_dispute(&mut self, lease_id: u64, landlord_amount: U128) {
        require!(env::predecessor_account_id() == self.arbiter, "Only the arbiter can decide");
        let lease = self.lease_ref(lease_id);
        require!(lease.status == LeaseStatus::Disputed, "This lease has no open dispute");
        require!(landlord_amount.0 <= lease.caution.0, "Amount can't be more than the caution fee");
        self.close(lease_id, landlord_amount.0, "arbiter");
    }

    /// Anyone, after a dispute stayed open for the dispute window: split the caution 50/50.
    pub fn settle_dispute_timeout(&mut self, lease_id: u64) {
        let lease = self.lease_ref(lease_id);
        require!(lease.status == LeaseStatus::Disputed, "This lease has no open dispute");
        let opened = lease.dispute.as_ref().unwrap().opened_at_ms;
        require!(
            env::block_timestamp_ms() >= opened + self.timeouts.dispute_secs * 1000,
            "The dispute window is still open"
        );
        let half = lease.caution.0 / 2;
        self.close(lease_id, half, "timeout_split");
    }

    /// Send your whole balance (or `amount`) to your account. If the transfer fails — for example
    /// your account isn't registered with the USDC contract — the balance is restored.
    pub fn withdraw(&mut self, amount: Option<U128>) -> Promise {
        let account = env::predecessor_account_id();
        let balance = self.balances.get(&account).copied().unwrap_or(0);
        let amount = amount.map(|a| a.0).unwrap_or(balance);
        require!(amount > 0, "Nothing to withdraw");
        require!(amount <= balance, "Amount is more than your balance");
        self.balances.insert(account.clone(), balance - amount);
        self.total_held -= amount;

        ext_ft::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(account.clone(), U128(amount), Some("Handova withdrawal".into()))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_WITHDRAW).on_withdraw(account, U128(amount)))
    }

    /// Callback: put the money back if the transfer failed. Returns the amount sent.
    #[private]
    pub fn on_withdraw(&mut self, account_id: AccountId, amount: U128) -> U128 {
        if env::promise_result_checked(0, 64).is_ok() {
            events::emit("withdrawn", json!({ "account_id": account_id, "amount": amount }));
            return amount;
        }
        self.credit(&account_id, amount.0);
        self.total_held += amount.0;
        events::emit("withdraw_failed", json!({ "account_id": account_id, "amount": amount }));
        U128(0)
    }
}

impl Contract {
    fn lease_ref(&self, lease_id: u64) -> &crate::Lease {
        self.leases.get(&lease_id).unwrap_or_else(|| env::panic_str("Lease not found"))
    }

    fn lease_mut(&mut self, lease_id: u64) -> &mut crate::Lease {
        self.leases.get_mut(&lease_id).unwrap_or_else(|| env::panic_str("Lease not found"))
    }

    /// Who the caution fee belongs to: the lease NFT owner, or the tenant before it's minted.
    pub(crate) fn holder(&self, lease_id: u64) -> AccountId {
        self.nft
            .owner_by_id
            .get(&lease_id.to_string())
            .unwrap_or_else(|| self.lease_ref(lease_id).tenant.clone())
    }

    /// Move-in: rent to the landlord, lease NFT (holding the caution) to the tenant.
    fn activate(&mut self, lease_id: u64) {
        let now = env::block_timestamp_ms();
        let lease = self.lease_mut(lease_id);
        lease.status = LeaseStatus::Active;
        lease.moved_in_at_ms = Some(now);
        lease.ends_at_ms = Some(now + lease.term_months as u64 * MONTH_SECS * 1000);
        let (landlord, tenant, rent) = (lease.landlord.clone(), lease.tenant.clone(), lease.rent.0);

        // total_held is unchanged: it counts escrow and balances alike; only withdraw lowers it.
        self.credit(&landlord, rent);

        let token_id = lease_id.to_string();
        self.nft.internal_mint_with_refund(token_id.clone(), tenant.clone(), None, None);
        NftMint { owner_id: &tenant, token_ids: &[&token_id], memo: Some("Handova lease") }.emit();
        events::emit(
            "moved_in",
            json!({ "lease_id": lease_id, "tenant": tenant, "landlord": landlord, "rent_paid": U128(rent) }),
        );
    }

    /// Refund the payer in full and free the home.
    fn cancel(&mut self, lease_id: u64, by: &str) {
        let now = env::block_timestamp_ms();
        let lease = self.lease_mut(lease_id);
        lease.status = LeaseStatus::Cancelled;
        lease.closed_at_ms = Some(now);
        let (payer, total, listing_id) = (lease.payer.clone(), lease.rent.0 + lease.caution.0, lease.listing_id);
        self.credit(&payer, total);
        self.free_listing(listing_id);
        events::emit("lease_cancelled", json!({ "lease_id": lease_id, "by": by, "refund_to": payer, "amount": U128(total) }));
    }

    /// Pay out the caution: `to_landlord` to the landlord, the rest to the NFT holder.
    fn close(&mut self, lease_id: u64, to_landlord: u128, how: &str) {
        let holder = self.holder(lease_id);
        let now = env::block_timestamp_ms();
        let lease = self.lease_mut(lease_id);
        let to_holder = lease.caution.0 - to_landlord;
        lease.status = LeaseStatus::Closed;
        lease.closed_at_ms = Some(now);
        lease.caution_to_landlord = U128(to_landlord);
        lease.caution_to_holder = U128(to_holder);
        let (landlord, listing_id) = (lease.landlord.clone(), lease.listing_id);
        self.credit(&landlord, to_landlord);
        self.credit(&holder, to_holder);
        self.free_listing(listing_id);
        events::emit(
            "lease_closed",
            json!({
                "lease_id": lease_id, "how": how, "holder": holder,
                "caution_to_holder": U128(to_holder), "caution_to_landlord": U128(to_landlord),
            }),
        );
    }

    fn free_listing(&mut self, listing_id: u64) {
        if let Some(l) = self.listings.get_mut(&listing_id) {
            l.active_lease = None;
        }
    }
}
