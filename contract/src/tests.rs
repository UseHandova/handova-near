//! Rule-by-rule unit tests. The end-to-end tests with a real token are in tests/.

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken, PromiseOrValue};

use crate::*;

const USDC: u128 = 1_000_000;
const RENT: u128 = 1_200 * USDC;
const CAUTION: u128 = 150 * USDC;
const DAY_MS: u64 = DAY_SECS * 1000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

struct T {
    c: Contract,
    now_ms: u64,
    /// The contract's NEAR balance in yocto, when a test needs it low.
    balance: Option<u128>,
}

impl T {
    fn new() -> Self {
        let mut t = T { c: setup_contract(), now_ms: 1_700_000_000_000, balance: None };
        t.as_("landlord.near");
        t
    }

    fn ctx(&self, who: &str, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc("handova.near"))
            .predecessor_account_id(acc(who))
            .signer_account_id(acc(who))
            .block_timestamp(self.now_ms * 1_000_000)
            .attached_deposit(NearToken::from_yoctonear(deposit));
        if let Some(y) = self.balance {
            b.account_balance(NearToken::from_yoctonear(y));
        }
        testing_env!(b.build());
    }

    /// Leave the contract with room for exactly `leases` leases of storage reserve.
    fn room_for(&mut self, leases: u128) {
        self.ctx("landlord.near", 0);
        let used = near_sdk::env::storage_usage() as u128;
        self.balance = Some((used + leases * LEASE_RESERVE_BYTES as u128) * near_sdk::env::storage_byte_cost().as_yoctonear());
    }

    fn as_(&mut self, who: &str) -> &mut Contract {
        self.ctx(who, 0);
        &mut self.c
    }

    fn wait_days(&mut self, d: u64) {
        self.now_ms += d * DAY_MS;
    }

    fn list(&mut self) -> u64 {
        self.as_("landlord.near").create_listing(U128(RENT), U128(CAUTION), 12, "lagos-yaba-2bed".into())
    }

    /// The USDC contract calling ft_on_transfer after `sender` did ft_transfer_call.
    fn pay(&mut self, sender: &str, amount: u128, msg: &str) -> u128 {
        let msg = with_terms(msg);
        self.pay_exact(sender, amount, &msg)
    }

    /// Same, sending `msg` exactly as given.
    fn pay_exact(&mut self, sender: &str, amount: u128, msg: &str) -> u128 {
        self.ctx("usdc.near", 0);
        match self.c.ft_on_transfer(acc(sender), U128(amount), msg.into()) {
            PromiseOrValue::Value(v) => v.0,
            _ => panic!("expected a value"),
        }
    }

    fn lease(&self, id: u64) -> Lease {
        self.c.get_lease(id).unwrap()
    }

    fn bal(&self, who: &str) -> u128 {
        self.c.balance_of(acc(who)).0
    }

    /// The holder offers lease 1, `buyer` asks for it and the landlord agrees to `buyer`.
    fn agree(&mut self, holder: &str, buyer: &str, price: u128) {
        self.as_(holder).offer_takeover(1, U128(price));
        self.as_(buyer).request_takeover(1);
        self.as_("landlord.near").consent_takeover(1, acc(buyer));
    }

    /// Paid and moved in: lease 1, NFT "1" owned by tenant.near.
    fn active_lease(&mut self) -> u64 {
        let l = self.list();
        self.pay("tenant.near", RENT + CAUTION, &format!(r#"{{"listing_id":{l}}}"#));
        self.as_("tenant.near").confirm_move_in(1);
        1
    }
}

/// Adds the listing's usual terms to a payment message that doesn't name its own.
fn with_terms(msg: &str) -> String {
    let mut v: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(msg).unwrap();
    let m = v.as_object_mut().unwrap();
    m.entry("rent").or_insert(RENT.to_string().into());
    m.entry("caution").or_insert(CAUTION.to_string().into());
    m.entry("term_months").or_insert(12.into());
    v.to_string()
}

fn setup_contract() -> Contract {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("handova.near")).predecessor_account_id(acc("owner.near"));
    testing_env!(b.build());
    Contract::new(acc("owner.near"), acc("verifier.near"), acc("arbiter.near"), acc("usdc.near"), None, None)
}

#[test]
fn full_lease_pay_move_in_move_out_refund() {
    let mut t = T::new();
    let l = t.list();
    // Overpaying by 5 USDC: the extra goes back.
    let unused = t.pay("tenant.near", RENT + CAUTION + 5 * USDC, &format!(r#"{{"listing_id":{l}}}"#));
    assert_eq!(unused, 5 * USDC);
    assert_eq!(t.lease(1).status, LeaseStatus::Pending);
    assert_eq!(t.c.get_config().total_held.0, RENT + CAUTION);
    assert_eq!(t.c.get_listings(None, None, Some(true)).len(), 0, "a paid home is not open");

    t.as_("tenant.near").confirm_move_in(1);
    let lease = t.lease(1);
    assert_eq!(lease.status, LeaseStatus::Active);
    assert_eq!(lease.nft_holder, Some(acc("tenant.near")));
    assert_eq!(t.bal("landlord.near"), RENT, "rent goes to the landlord at move-in");
    assert_eq!(t.bal("tenant.near"), 0, "caution stays in the NFT");

    let token = t.c.nft_token("1".into()).unwrap();
    assert_eq!(token.owner_id, acc("tenant.near"));
    let meta = token.metadata.unwrap();
    assert!(meta.title.unwrap().contains("Active"));
    assert!(meta.extra.unwrap().contains(r#""caution_held":"150000000""#));
    assert!(meta.media.unwrap().starts_with("data:image/svg+xml;base64,"));

    t.as_("tenant.near").move_out(1);
    assert_eq!(t.lease(1).status, LeaseStatus::Ending);
    t.as_("landlord.near").approve_move_out(1);
    let lease = t.lease(1);
    assert_eq!(lease.status, LeaseStatus::Closed);
    assert_eq!(lease.caution_to_holder.0, CAUTION);
    assert_eq!(t.bal("tenant.near"), CAUTION);
    assert_eq!(t.c.get_config().total_held.0, RENT + CAUTION, "still owed until withdrawn");
    assert_eq!(t.c.get_listings(None, None, Some(true)).len(), 1, "home is open again");
    // The NFT stays with the tenant as a finished-lease record.
    let meta = t.c.nft_token("1".into()).unwrap().metadata.unwrap();
    assert!(meta.title.unwrap().contains("Closed"));
}

#[test]
fn family_abroad_pays_for_tenant() {
    let mut t = T::new();
    let l = t.list();
    t.pay("nurse.near", RENT + CAUTION, &format!(r#"{{"listing_id":{l},"tenant":"mum.near"}}"#));
    let lease = t.lease(1);
    assert_eq!(lease.tenant, acc("mum.near"));
    assert_eq!(lease.payer, acc("nurse.near"));
    assert_eq!(t.c.get_leases_for(acc("nurse.near")).len(), 1);
    assert_eq!(t.c.get_leases_for(acc("mum.near")).len(), 1);

    // Only the tenant who lives there confirms move-in, not the payer.
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.as_("nurse.near").confirm_move_in(1)));
    assert!(r.is_err());
    t.as_("mum.near").confirm_move_in(1);
    assert_eq!(t.c.nft_tokens_for_owner(acc("mum.near"), None, None).len(), 1);
}

#[test]
fn payer_refunded_when_no_handover_in_7_days() {
    let mut t = T::new();
    let l = t.list();
    t.pay("nurse.near", RENT + CAUTION, &format!(r#"{{"listing_id":{l},"tenant":"mum.near"}}"#));
    t.wait_days(6);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.as_("mum.near").cancel_lease(1)));
    assert!(r.is_err(), "landlord still has time");
    t.wait_days(1);
    t.as_("mum.near").cancel_lease(1);
    assert_eq!(t.lease(1).status, LeaseStatus::Cancelled);
    assert_eq!(t.bal("nurse.near"), RENT + CAUTION, "refund goes to whoever paid");
    assert_eq!(t.bal("mum.near"), 0);
    assert_eq!(t.c.get_listings(None, None, Some(true)).len(), 1);
}

#[test]
fn landlord_can_decline_any_time_before_move_in() {
    let mut t = T::new();
    let l = t.list();
    t.pay("tenant.near", RENT + CAUTION, &format!(r#"{{"listing_id":{l}}}"#));
    t.as_("landlord.near").mark_handover(1);
    t.as_("landlord.near").cancel_lease(1);
    assert_eq!(t.bal("tenant.near"), RENT + CAUTION);
}

#[test]
#[should_panic(expected = "confirm move-in or dispute it")]
fn tenant_cannot_cancel_after_handover() {
    let mut t = T::new();
    let l = t.list();
    t.pay("tenant.near", RENT + CAUTION, &format!(r#"{{"listing_id":{l}}}"#));
    t.as_("landlord.near").mark_handover(1);
    t.wait_days(8);
    t.as_("tenant.near").cancel_lease(1);
}

#[test]
fn landlord_claims_move_in_after_3_silent_days() {
    let mut t = T::new();
    t.as_("verifier.near").set_verified(acc("landlord.near"), true);
    let l = t.list();
    t.pay("tenant.near", RENT + CAUTION, &format!(r#"{{"listing_id":{l}}}"#));
    t.as_("landlord.near").mark_handover(1);
    t.wait_days(2);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.as_("landlord.near").claim_move_in(1)));
    assert!(r.is_err(), "tenant still has time");
    t.wait_days(1);
    // Anyone may trigger it (e.g. Handova's keeper); the result is fixed by the rules.
    t.as_("keeper.near").claim_move_in(1);
    assert_eq!(t.lease(1).status, LeaseStatus::Active);
    assert_eq!(t.bal("landlord.near"), RENT);
    assert_eq!(t.lease(1).nft_holder, Some(acc("tenant.near")));
}

#[test]
fn tenant_disputes_fake_handover_and_arbiter_refunds() {
    let mut t = T::new();
    let l = t.list();
    t.pay("tenant.near", RENT + CAUTION, &format!(r#"{{"listing_id":{l}}}"#));
    t.as_("landlord.near").mark_handover(1);
    t.as_("tenant.near").dispute_move_in(1, "No keys, house locked".into());
    t.wait_days(4);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.as_("landlord.near").claim_move_in(1)));
    assert!(r.is_err(), "dispute blocks the automatic claim");
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.as_("landlord.near").resolve_move_in(1, true)));
    assert!(r.is_err(), "only the arbiter decides");
    t.as_("arbiter.near").resolve_move_in(1, false);
    assert_eq!(t.lease(1).status, LeaseStatus::Cancelled);
    assert_eq!(t.bal("tenant.near"), RENT + CAUTION);
}

#[test]
fn caution_returned_when_landlord_silent_for_review_window() {
    let mut t = T::new();
    t.active_lease();
    t.as_("tenant.near").move_out(1);
    t.wait_days(6);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.as_("tenant.near").claim_caution(1)));
    assert!(r.is_err());
    t.wait_days(1);
    t.as_("tenant.near").claim_caution(1);
    assert_eq!(t.bal("tenant.near"), CAUTION);
}

#[test]
fn dispute_settled_by_agreement() {
    let mut t = T::new();
    t.active_lease();
    t.as_("tenant.near").move_out(1);
    t.as_("landlord.near").dispute_caution(1, U128(100 * USDC), "Broken window".into());
    assert_eq!(t.lease(1).status, LeaseStatus::Disputed);
    t.as_("tenant.near").propose_split(1, U128(40 * USDC));
    assert_eq!(t.lease(1).status, LeaseStatus::Disputed);
    t.as_("landlord.near").propose_split(1, U128(40 * USDC));
    let lease = t.lease(1);
    assert_eq!(lease.status, LeaseStatus::Closed);
    assert_eq!(t.bal("landlord.near"), RENT + 40 * USDC);
    assert_eq!(t.bal("tenant.near"), 110 * USDC);
}

#[test]
fn dispute_decided_by_arbiter() {
    let mut t = T::new();
    t.active_lease();
    t.as_("tenant.near").move_out(1);
    t.as_("landlord.near").dispute_caution(1, U128(150 * USDC), "Damage".into());
    t.as_("arbiter.near").resolve_dispute(1, U128(30 * USDC));
    assert_eq!(t.bal("landlord.near"), RENT + 30 * USDC);
    assert_eq!(t.bal("tenant.near"), 120 * USDC);
}

#[test]
fn dispute_nobody_acts_splits_50_50() {
    let mut t = T::new();
    t.active_lease();
    t.as_("tenant.near").move_out(1);
    t.as_("landlord.near").dispute_caution(1, U128(150 * USDC), "Damage".into());
    t.wait_days(7);
    t.as_("anyone.near").settle_dispute_timeout(1);
    assert_eq!(t.bal("landlord.near"), RENT + 75 * USDC);
    assert_eq!(t.bal("tenant.near"), 75 * USDC);
}

#[test]
#[should_panic(expected = "The review window has ended")]
fn landlord_cannot_dispute_after_review_window() {
    let mut t = T::new();
    t.active_lease();
    t.as_("tenant.near").move_out(1);
    t.wait_days(7);
    t.as_("landlord.near").dispute_caution(1, U128(10 * USDC), "Late".into());
}

#[test]
fn caution_follows_the_nft() {
    let mut t = T::new();
    t.active_lease();
    // The landlord agrees to a new tenant; the holder hands the NFT (and its caution) over directly.
    t.agree("tenant.near", "newtenant.near", 0);
    t.ctx("tenant.near", 1);
    t.c.nft_transfer(acc("newtenant.near"), "1".into(), None, None);
    assert_eq!(t.lease(1).nft_holder, Some(acc("newtenant.near")));
    assert_eq!(t.lease(1).tenant, acc("newtenant.near"));
    assert_eq!(t.c.get_leases_for(acc("newtenant.near")).len(), 1);

    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.as_("tenant.near").move_out(1)));
    assert!(r.is_err(), "old tenant no longer holds the lease");
    t.as_("newtenant.near").move_out(1);
    t.as_("landlord.near").approve_move_out(1);
    assert_eq!(t.bal("newtenant.near"), CAUTION);
    assert_eq!(t.bal("tenant.near"), 0);
}

#[test]
#[should_panic(expected = "This lease NFT is locked")]
fn nft_locked_during_move_out_review() {
    let mut t = T::new();
    t.active_lease();
    t.as_("tenant.near").move_out(1);
    t.ctx("tenant.near", 1);
    t.c.nft_transfer(acc("friend.near"), "1".into(), None, None);
}

#[test]
fn landlord_starts_move_out_only_after_term() {
    let mut t = T::new();
    t.active_lease();
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.as_("landlord.near").move_out(1)));
    assert!(r.is_err());
    t.wait_days(365);
    t.as_("landlord.near").move_out(1);
    assert_eq!(t.lease(1).status, LeaseStatus::Ending);
}

#[test]
#[should_panic(expected = "Only the configured USDC token is accepted")]
fn rejects_other_tokens() {
    let mut t = T::new();
    t.list();
    t.ctx("fake-usdc.near", 0);
    let _ = t.c.ft_on_transfer(acc("tenant.near"), U128(RENT + CAUTION), r#"{"listing_id":1}"#.into());
}

#[test]
#[should_panic(expected = "Payment too small")]
fn rejects_underpayment() {
    let mut t = T::new();
    t.list();
    t.pay("tenant.near", RENT, r#"{"listing_id":1}"#);
}

#[test]
#[should_panic(expected = "already taken")]
fn one_lease_per_home() {
    let mut t = T::new();
    t.list();
    t.pay("tenant.near", RENT + CAUTION, r#"{"listing_id":1}"#);
    t.pay("other.near", RENT + CAUTION, r#"{"listing_id":1}"#);
}

#[test]
#[should_panic(expected = "can't rent their own home")]
fn landlord_cannot_rent_own_home() {
    let mut t = T::new();
    t.list();
    t.pay("landlord.near", RENT + CAUTION, r#"{"listing_id":1}"#);
}

#[test]
#[should_panic(expected = "Prices can't change")]
fn prices_locked_during_lease() {
    let mut t = T::new();
    t.list();
    t.pay("tenant.near", RENT + CAUTION, r#"{"listing_id":1}"#);
    t.as_("landlord.near").update_listing(1, Some(U128(RENT * 2)), None, None, None, None);
}

#[test]
fn only_verifier_marks_landlords() {
    let mut t = T::new();
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.as_("landlord.near").set_verified(acc("landlord.near"), true)
    }));
    assert!(r.is_err());
    t.as_("verifier.near").set_verified(acc("landlord.near"), true);
    let l = t.list();
    assert!(t.c.get_listing(l).unwrap().landlord_verified);
}

#[test]
fn withdraw_takes_balance_and_failed_transfer_restores_it() {
    let mut t = T::new();
    t.active_lease();
    let _ = t.as_("landlord.near").withdraw(None);
    assert_eq!(t.bal("landlord.near"), 0);
    assert_eq!(t.c.get_config().total_held.0, CAUTION);

    // The token transfer failed (e.g. landlord not registered with USDC): money comes back.
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("handova.near")).predecessor_account_id(acc("handova.near"));
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![near_sdk::PromiseResult::Failed]
    );
    assert_eq!(t.c.on_withdraw(acc("landlord.near"), U128(RENT)).0, 0);
    assert_eq!(t.bal("landlord.near"), RENT);
    assert_eq!(t.c.get_config().total_held.0, RENT + CAUTION);
}

#[test]
fn keeper_can_page_through_leases() {
    let mut t = T::new();
    t.list();
    t.pay("tenant.near", RENT + CAUTION, r#"{"listing_id":1}"#);
    t.as_("landlord.near").cancel_lease(1);
    t.pay("other.near", RENT + CAUTION, r#"{"listing_id":1}"#);
    let all = t.c.get_leases(None, None);
    assert_eq!(all.iter().map(|l| l.id).collect::<Vec<_>>(), vec![1, 2]);
    assert_eq!(t.c.get_leases(Some(1), Some(10))[0].id, 2);
}

#[test]
#[should_panic(expected = "Rent must be at least 1 USDC")]
fn rent_has_a_minimum() {
    let mut t = T::new();
    t.as_("landlord.near").create_listing(U128(999_999), U128(0), 12, "x".into());
}

#[test]
#[should_panic(expected = "Only landlords who were ID-verified when the tenant paid")]
fn unverified_landlord_cannot_collect_by_silence() {
    let mut t = T::new();
    let l = t.list();
    t.pay("tenant.near", RENT + CAUTION, &format!(r#"{{"listing_id":{l}}}"#));
    t.as_("landlord.near").mark_handover(1);
    t.wait_days(30);
    t.as_("keeper.near").claim_move_in(1);
}

#[test]
fn disputed_handover_refunds_payer_if_arbiter_silent() {
    let mut t = T::new();
    let l = t.list();
    t.pay("nurse.near", RENT + CAUTION, &format!(r#"{{"listing_id":{l},"tenant":"mum.near"}}"#));
    t.as_("landlord.near").mark_handover(1);
    t.as_("mum.near").dispute_move_in(1, "No keys".into());
    t.wait_days(6);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.as_("anyone.near").settle_move_in_timeout(1)));
    assert!(r.is_err(), "arbiter still has time");
    t.wait_days(1);
    t.as_("anyone.near").settle_move_in_timeout(1);
    assert_eq!(t.lease(1).status, LeaseStatus::Cancelled);
    assert_eq!(t.bal("nurse.near"), RENT + CAUTION);
}

#[test]
fn unverified_landlords_list_up_to_3_homes() {
    let mut t = T::new();
    for _ in 0..3 {
        t.list();
    }
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.list()));
    assert!(r.is_err());
    t.as_("verifier.near").set_verified(acc("landlord.near"), true);
    t.list();
}

#[test]
fn twelve_month_lease_lasts_365_days() {
    let mut t = T::new();
    t.active_lease();
    let l = t.lease(1);
    assert_eq!(l.ends_at_ms.unwrap() - l.moved_in_at_ms.unwrap(), 365 * DAY_MS);
}

#[test]
fn unverified_landlord_escalates_to_arbiter_when_tenant_wont_confirm() {
    let mut t = T::new();
    let l = t.list();
    t.pay("tenant.near", RENT + CAUTION, &format!(r#"{{"listing_id":{l}}}"#));
    t.as_("landlord.near").mark_handover(1);
    t.as_("landlord.near").dispute_move_in(1, "Tenant moved in but won't confirm".into());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.as_("tenant.near").dispute_move_in(1, "again".into())));
    assert!(r.is_err(), "a dispute can be opened only once");
    t.as_("arbiter.near").resolve_move_in(1, true);
    assert_eq!(t.lease(1).status, LeaseStatus::Active);
    assert_eq!(t.bal("landlord.near"), RENT);
}

#[test]
fn timeout_split_never_gives_landlord_more_than_claimed() {
    let mut t = T::new();
    t.active_lease();
    t.as_("tenant.near").move_out(1);
    t.as_("landlord.near").dispute_caution(1, U128(20 * USDC), "Scuffed wall".into());
    t.wait_days(7);
    t.as_("anyone.near").settle_dispute_timeout(1);
    assert_eq!(t.bal("landlord.near"), RENT + 20 * USDC);
    assert_eq!(t.bal("tenant.near"), CAUTION - 20 * USDC);
}

#[test]
#[should_panic(expected = "can't award more than the landlord claimed")]
fn arbiter_capped_at_claim() {
    let mut t = T::new();
    t.active_lease();
    t.as_("tenant.near").move_out(1);
    t.as_("landlord.near").dispute_caution(1, U128(20 * USDC), "Scuffed wall".into());
    t.as_("arbiter.near").resolve_dispute(1, U128(21 * USDC));
}

#[test]
fn lease_takeover_needs_landlord_consent_then_moves_nft_and_pays_holder() {
    let mut t = T::new();
    t.active_lease();
    let price = 300 * USDC;
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.as_("landlord.near").offer_takeover(1, U128(price))));
    assert!(r.is_err(), "only the holder offers");
    t.as_("tenant.near").offer_takeover(1, U128(price));
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.pay("newtenant.near", price, r#"{"take_over":1}"#)));
    assert!(r.is_err(), "landlord hasn't consented");
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.as_("landlord.near").consent_takeover(1, acc("newtenant.near"))));
    assert!(r.is_err(), "nobody has asked yet, so there is nobody to agree to");
    t.as_("newtenant.near").request_takeover(1);
    t.as_("landlord.near").consent_takeover(1, acc("newtenant.near"));
    let unused = t.pay("newtenant.near", price + 2 * USDC, r#"{"take_over":1}"#);
    assert_eq!(unused, 2 * USDC);
    let lease = t.lease(1);
    assert_eq!(lease.tenant, acc("newtenant.near"));
    assert_eq!(lease.nft_holder, Some(acc("newtenant.near")));
    assert!(lease.takeover.is_none());
    assert_eq!(t.bal("tenant.near"), price, "seller paid");
    // The caution now belongs to the buyer.
    t.as_("newtenant.near").move_out(1);
    t.as_("landlord.near").approve_move_out(1);
    assert_eq!(t.bal("newtenant.near"), CAUTION);
    assert_eq!(t.c.get_config().total_held.0, RENT + CAUTION + price);
}

#[test]
fn marketplace_sale_needs_landlord_consent_and_pays_the_holder() {
    let mut t = T::new();
    t.active_lease();
    // The holder approves a marketplace (NEP-178).
    t.ctx("tenant.near", 1_000_000_000_000_000_000_000);
    t.c.nft_approve("1".into(), acc("market.near"), None);
    let sale = || {
        let mut c = VMContextBuilder::new();
        c.current_account_id(acc("handova.near")).predecessor_account_id(acc("market.near")).attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(c.build());
    };
    // Without the landlord's consent the marketplace can't complete a sale.
    sale();
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.c.nft_transfer_payout(acc("buyer.near"), "1".into(), Some(1), None, U128(250 * USDC), Some(10))));
    assert!(r.is_err(), "no consent, no sale");
    t.as_("tenant.near").offer_takeover(1, U128(250 * USDC));
    t.as_("buyer.near").request_takeover(1);
    t.as_("landlord.near").consent_takeover(1, acc("buyer.near"));
    // The landlord can't buy their own lease.
    sale();
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.c.nft_transfer_payout(acc("landlord.near"), "1".into(), Some(1), None, U128(250 * USDC), Some(10))));
    assert!(r.is_err());
    // NEP-199: the payout names the holder; after the sale the buyer is the tenant and holds the caution.
    assert_eq!(t.c.nft_payout("1".into(), U128(250 * USDC), Some(10)).payout.get(&acc("tenant.near")), Some(&U128(250 * USDC)));
    sale();
    let p = t.c.nft_transfer_payout(acc("buyer.near"), "1".into(), Some(1), None, U128(250 * USDC), Some(10));
    assert_eq!(p.payout.len(), 1);
    assert_eq!(p.payout.get(&acc("tenant.near")), Some(&U128(250 * USDC)));
    let lease = t.lease(1);
    assert_eq!(lease.tenant, acc("buyer.near"));
    assert_eq!(lease.nft_holder, Some(acc("buyer.near")));
    assert!(lease.takeover.is_none());
    t.as_("buyer.near").move_out(1);
    t.as_("landlord.near").approve_move_out(1);
    assert_eq!(t.bal("buyer.near"), CAUTION, "the caution follows the lease to the buyer");
}

#[test]
fn marketplace_sale_refused_once_the_lease_is_locked() {
    let mut t = T::new();
    t.active_lease();
    t.ctx("tenant.near", 1_000_000_000_000_000_000_000);
    t.c.nft_approve("1".into(), acc("market.near"), None);
    t.agree("tenant.near", "buyer.near", USDC);
    t.as_("tenant.near").move_out(1);
    let mut c = VMContextBuilder::new();
    c.current_account_id(acc("handova.near")).predecessor_account_id(acc("market.near")).attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(c.build());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.c.nft_transfer_payout(acc("buyer.near"), "1".into(), Some(1), None, U128(USDC), None)));
    assert!(r.is_err(), "locked during move-out review");
}

#[test]
fn takeover_offer_ends_when_nft_moves_another_way() {
    let mut t = T::new();
    t.active_lease();
    t.agree("tenant.near", "friend.near", USDC);
    t.ctx("tenant.near", 1);
    t.c.nft_transfer(acc("friend.near"), "1".into(), None, None);
    assert!(t.lease(1).takeover.is_none(), "the offer and its consent end once the lease has moved");
}

#[test]
fn rental_passport_counts_finished_leases() {
    let mut t = T::new();
    t.active_lease();
    t.as_("tenant.near").move_out(1);
    t.as_("landlord.near").approve_move_out(1);
    // Second lease on the same home: caution partly kept.
    t.pay("tenant.near", RENT + CAUTION, r#"{"listing_id":1}"#);
    t.as_("tenant.near").confirm_move_in(2);
    t.as_("tenant.near").move_out(2);
    t.as_("landlord.near").dispute_caution(2, U128(10 * USDC), "Stain".into());
    t.as_("arbiter.near").resolve_dispute(2, U128(10 * USDC));
    let r = t.c.rental_record(acc("tenant.near"));
    assert_eq!(r.leases_completed, 2);
    assert_eq!(r.caution_returned_in_full, 1);
    assert_eq!(r.caution_partly_kept, 1);
    assert_eq!(r.caution_returned_total.0, 2 * CAUTION - 10 * USDC);
    assert_eq!(r.leases_moved_in, 2);
    assert_eq!(r.months_rented, 0, "both leases ended the day they began");
    assert_eq!(r.rent_paid_total.0, 2 * RENT);
    assert_eq!(r.active_leases, 0);
}

#[test]
fn approvals_only_while_active() {
    let mut t = T::new();
    t.active_lease();
    t.ctx("tenant.near", 10_000_000_000_000_000_000_000);
    use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
    let _ = t.c.nft_approve("1".into(), acc("market.near"), None);
    assert!(t.c.nft_is_approved("1".into(), acc("market.near"), None));
    // The marketplace moves it for the holder, to the tenant the landlord agreed to.
    t.agree("tenant.near", "buyer.near", USDC);
    t.ctx("market.near", 1);
    t.c.nft_transfer(acc("buyer.near"), "1".into(), None, None);
    assert_eq!(t.lease(1).nft_holder, Some(acc("buyer.near")));
    assert!(!t.c.nft_is_approved("1".into(), acc("market.near"), None), "approvals cleared on transfer");
}

// ---------- Authority: nobody gets around the landlord, the lease's arbiter, or the verifier ----------

fn refused(f: impl FnOnce()) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err()
}

#[test]
fn lease_never_moves_without_the_landlords_consent() {
    let mut t = T::new();
    t.active_lease();
    // A plain transfer, even to the holder's own second wallet, is refused without consent.
    t.ctx("tenant.near", 1);
    assert!(refused(|| t.c.nft_transfer(acc("stranger.near"), "1".into(), None, None)));
    assert!(refused(|| { let _ = t.c.nft_transfer_call(acc("stranger.near"), "1".into(), None, None, "".into()); }));
    // An offer alone isn't consent either.
    t.as_("tenant.near").offer_takeover(1, U128(USDC));
    t.ctx("tenant.near", 1);
    assert!(refused(|| t.c.nft_transfer(acc("stranger.near"), "1".into(), None, None)));
    // A marketplace the holder approved can't settle a sale without consent.
    t.ctx("tenant.near", 1_000_000_000_000_000_000_000);
    let _ = t.c.nft_approve("1".into(), acc("market.near"), None);
    let mut c = VMContextBuilder::new();
    c.current_account_id(acc("handova.near")).predecessor_account_id(acc("market.near")).attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(c.build());
    assert!(refused(|| { t.c.nft_transfer_payout(acc("stranger.near"), "1".into(), Some(1), None, U128(USDC), Some(10)); }));
    assert_eq!(t.lease(1).nft_holder, Some(acc("tenant.near")));
    assert_eq!(t.lease(1).tenant, acc("tenant.near"));
}

#[test]
fn consent_is_for_one_person_only() {
    let mut t = T::new();
    t.active_lease();
    t.agree("tenant.near", "alice.near", 50 * USDC);
    // Someone else can't swap in after the landlord agreed: not by asking, paying, transfer or marketplace.
    assert!(refused(|| t.as_("mallory.near").request_takeover(1)));
    assert!(refused(|| { t.pay("mallory.near", 50 * USDC, r#"{"take_over":1}"#); }));
    t.ctx("tenant.near", 1);
    assert!(refused(|| t.c.nft_transfer(acc("mallory.near"), "1".into(), None, None)));
    t.ctx("tenant.near", 1_000_000_000_000_000_000_000);
    let _ = t.c.nft_approve("1".into(), acc("market.near"), None);
    let mut c = VMContextBuilder::new();
    c.current_account_id(acc("handova.near")).predecessor_account_id(acc("market.near")).attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(c.build());
    assert!(refused(|| { t.c.nft_transfer_payout(acc("mallory.near"), "1".into(), Some(1), None, U128(50 * USDC), Some(10)); }));
    // A new offer from the holder resets the consent; the landlord must agree again.
    t.as_("tenant.near").offer_takeover(1, U128(60 * USDC));
    assert!(refused(|| { t.pay("alice.near", 60 * USDC, r#"{"take_over":1}"#); }));
    // The agreed person can take over.
    t.as_("alice.near").request_takeover(1);
    t.as_("landlord.near").consent_takeover(1, acc("alice.near"));
    t.pay("alice.near", 60 * USDC, r#"{"take_over":1}"#);
    assert_eq!(t.lease(1).tenant, acc("alice.near"));
    assert_eq!(t.lease(1).nft_holder, Some(acc("alice.near")));
}

#[test]
fn a_new_arbiter_cannot_rule_on_a_lease_that_was_already_open() {
    let mut t = T::new();
    t.active_lease();
    t.as_("tenant.near").move_out(1);
    t.as_("landlord.near").dispute_caution(1, U128(100 * USDC), "Broken window".into());
    // The owner appoints a different arbiter mid-dispute: it has no say over this lease.
    t.as_("owner.near").set_arbiter(acc("friendly-arbiter.near"));
    assert!(refused(|| t.as_("friendly-arbiter.near").resolve_dispute(1, U128(100 * USDC))));
    assert_eq!(t.lease(1).arbiter, acc("arbiter.near"));
    // The arbiter the lease was opened with still decides.
    t.as_("arbiter.near").resolve_dispute(1, U128(30 * USDC));
    assert_eq!(t.lease(1).status, LeaseStatus::Closed);
    // Leases paid after the change use the new arbiter.
    let l = t.list();
    t.pay("tenant2.near", RENT + CAUTION, &format!(r#"{{"listing_id":{l}}}"#));
    assert_eq!(t.lease(2).arbiter, acc("friendly-arbiter.near"));
}

#[test]
fn a_verifier_changed_mid_lease_cannot_unlock_a_silence_claim() {
    let mut t = T::new();
    let l = t.list();
    t.pay("tenant.near", RENT + CAUTION, &format!(r#"{{"listing_id":{l}}}"#));
    assert!(!t.lease(1).landlord_verified);
    // The owner installs a new verifier, which verifies the landlord after the tenant paid.
    t.as_("owner.near").set_verifier(acc("new-verifier.near"));
    t.as_("new-verifier.near").set_verified(acc("landlord.near"), true);
    t.as_("landlord.near").mark_handover(1);
    t.wait_days(4);
    assert!(refused(|| t.as_("anyone.near").claim_move_in(1)), "not verified when the tenant paid");
    assert_eq!(t.lease(1).status, LeaseStatus::Pending);
}

#[test]
fn a_revoked_badge_also_stops_a_silence_claim() {
    let mut t = T::new();
    t.as_("verifier.near").set_verified(acc("landlord.near"), true);
    let l = t.list();
    t.pay("tenant.near", RENT + CAUTION, &format!(r#"{{"listing_id":{l}}}"#));
    assert!(t.lease(1).landlord_verified);
    t.as_("verifier.near").set_verified(acc("landlord.near"), false);
    t.as_("landlord.near").mark_handover(1);
    t.wait_days(4);
    assert!(refused(|| t.as_("anyone.near").claim_move_in(1)));
}

// ---------- Consent names a person ----------

#[test]
fn consent_is_for_the_person_the_landlord_reviewed() {
    let mut t = T::new();
    t.active_lease();
    t.as_("tenant.near").offer_takeover(1, U128(USDC));
    t.as_("reviewed.near").request_takeover(1);
    // A second request lands just before the landlord's call.
    t.as_("stranger.near").request_takeover(1);
    assert!(refused(|| t.as_("landlord.near").consent_takeover(1, acc("reviewed.near"))), "the landlord agreed to someone else");
    let offer = t.lease(1).takeover.unwrap();
    assert!(!offer.landlord_consent);
    assert!(refused(|| { t.pay("stranger.near", USDC, r#"{"take_over":1}"#); }));
    // The landlord can still agree to the person now asking, by naming them.
    t.as_("landlord.near").consent_takeover(1, acc("stranger.near"));
    assert!(t.lease(1).takeover.unwrap().landlord_consent);
}

// ---------- Payment terms ----------

#[test]
fn payment_is_refused_if_the_listing_changed_after_the_payer_saw_it() {
    let mut t = T::new();
    let l = t.list();
    t.as_("landlord.near").update_listing(l, None, None, Some(1), None, None);
    assert!(refused(|| { t.pay("tenant.near", RENT + CAUTION, r#"{"listing_id":1}"#); }), "term cut from 12 months to 1");
    t.as_("landlord.near").update_listing(l, None, Some(U128(CAUTION + USDC)), Some(12), None, None);
    assert!(refused(|| { t.pay("tenant.near", RENT + CAUTION + USDC, r#"{"listing_id":1}"#); }), "caution raised, overpayment would hide it");
    t.as_("landlord.near").update_listing(l, Some(U128(RENT + USDC)), Some(U128(CAUTION)), None, None, None);
    assert!(refused(|| { t.pay("tenant.near", RENT + CAUTION + USDC, r#"{"listing_id":1}"#); }), "rent raised, overpayment would hide it");
    assert_eq!(t.c.get_config().leases, 0);
}

#[test]
fn payment_must_name_its_terms() {
    let mut t = T::new();
    t.list();
    assert!(refused(|| { t.pay_exact("tenant.near", RENT + CAUTION, r#"{"listing_id":1}"#); }));
}

// ---------- Listing details are fixed per lease ----------

#[test]
fn lease_keeps_the_details_it_was_paid_under() {
    let mut t = T::new();
    t.active_lease();
    t.as_("landlord.near").update_listing(1, None, None, None, Some("other-photos".into()), None);
    assert_eq!(t.c.get_listing(1).unwrap().listing.property_ref, "other-photos");
    assert_eq!(t.lease(1).property_ref, "lagos-yaba-2bed");
}

// ---------- Passport counts time lived ----------

#[test]
fn passport_counts_months_lived_not_the_term() {
    let mut t = T::new();
    t.active_lease();
    assert_eq!(t.c.rental_record(acc("tenant.near")).months_rented, 0, "just moved in");
    t.wait_days(92);
    t.as_("tenant.near");
    assert_eq!(t.c.rental_record(acc("tenant.near")).months_rented, 3, "three months in");
    t.as_("tenant.near").move_out(1);
    t.as_("landlord.near").approve_move_out(1);
    t.wait_days(300);
    t.as_("tenant.near");
    assert_eq!(t.c.rental_record(acc("tenant.near")).months_rented, 3, "the count stops at move-out");
}

#[test]
fn passport_never_counts_more_than_the_term() {
    let mut t = T::new();
    t.active_lease();
    t.wait_days(800);
    t.as_("tenant.near");
    assert_eq!(t.c.rental_record(acc("tenant.near")).months_rented, 12);
}

#[test]
fn takeover_tenant_counts_from_the_takeover_and_pays_no_rent_on_their_record() {
    let mut t = T::new();
    t.active_lease();
    t.wait_days(150);
    t.agree("tenant.near", "friend.near", USDC);
    t.pay("friend.near", USDC, r#"{"take_over":1}"#);
    t.wait_days(31);
    t.as_("friend.near");
    let r = t.c.rental_record(acc("friend.near"));
    assert_eq!(r.months_rented, 1);
    assert_eq!(r.rent_paid_total.0, 0, "the rent was paid by the first tenant");
}

#[test]
fn takeover_by_direct_transfer_also_restarts_the_count() {
    let mut t = T::new();
    t.active_lease();
    t.wait_days(150);
    t.agree("tenant.near", "friend.near", USDC);
    t.ctx("tenant.near", 1);
    t.c.nft_transfer(acc("friend.near"), "1".into(), None, None);
    t.as_("friend.near");
    assert_eq!(t.c.rental_record(acc("friend.near")).months_rented, 0);
}

// ---------- Storage reserve ----------

#[test]
fn nothing_new_is_stored_when_the_reserve_is_short() {
    let mut t = T::new();
    t.list();
    t.room_for(0);
    assert!(refused(|| { t.list(); }), "new listing");
    assert!(refused(|| { t.pay("tenant.near", RENT + CAUTION, r#"{"listing_id":1}"#); }), "new lease");
    assert!(refused(|| t.as_("landlord.near").update_listing(1, None, None, None, Some("x".into()), None)), "bigger details");
    // Pausing a listing stores nothing new, so it still works.
    t.as_("landlord.near").update_listing(1, None, None, None, None, Some(false));
}

#[test]
fn an_open_lease_keeps_its_reserve() {
    let mut t = T::new();
    t.list();
    t.room_for(1);
    t.pay("tenant.near", RENT + CAUTION, r#"{"listing_id":1}"#);
    assert_eq!(t.c.get_config().open_leases, 1);
    assert!(refused(|| { t.list(); }), "that room belongs to the open lease");
    // The lease itself is never held back, however low the balance is.
    t.as_("tenant.near").confirm_move_in(1);
    assert!(refused(|| t.as_("tenant.near").offer_takeover(1, U128(USDC))), "a takeover is optional and stores more");
    t.as_("tenant.near").move_out(1);
    t.as_("landlord.near").approve_move_out(1);
    assert_eq!(t.c.get_config().open_leases, 0);
}

#[test]
fn a_cancelled_lease_releases_its_reserve() {
    let mut t = T::new();
    let l = t.list();
    t.pay("tenant.near", RENT + CAUTION, &format!(r#"{{"listing_id":{l}}}"#));
    assert_eq!(t.c.get_config().open_leases, 1);
    t.as_("landlord.near").cancel_lease(1);
    assert_eq!(t.c.get_config().open_leases, 0);
}
