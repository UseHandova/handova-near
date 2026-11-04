//! End-to-end on a local NEAR sandbox: real token contract, real `ft_transfer_call`, real NFT,
//! real withdrawals. Run with `cargo test --test sandbox` (needs cargo-near).

use near_workspaces::network::Sandbox;
use near_workspaces::types::NearToken;
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};

const USDC: u128 = 1_000_000;
const RENT: u128 = 1_200 * USDC;
const CAUTION: u128 = 150 * USDC;
/// Short waiting periods so the test can pass them by producing blocks.
const WAIT_SECS: u64 = 5;

struct Env {
    worker: Worker<Sandbox>,
    usdc: Contract,
    handova: Contract,
    landlord: Account,
    nurse: Account,
    mum: Account,
}

async fn account(worker: &Worker<Sandbox>, name: &str) -> anyhow::Result<Account> {
    Ok(worker
        .root_account()?
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?)
}

async fn setup() -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let usdc = worker.dev_deploy(&near_workspaces::compile_project("./mock-ft").await?).await?;
    usdc.call("new").transact().await?.into_result()?;
    let handova = worker.dev_deploy(&near_workspaces::compile_project("./").await?).await?;

    let landlord = account(&worker, "landlord").await?;
    let nurse = account(&worker, "nurse").await?;
    let mum = account(&worker, "mum").await?;
    let admin = account(&worker, "admin").await?;

    handova
        .call("new")
        .args_json(json!({
            "owner": admin.id(), "verifier": admin.id(), "arbiter": admin.id(), "token": usdc.id(),
            "timeouts": {
                "handover_claim_secs": WAIT_SECS, "cancel_after_secs": WAIT_SECS,
                "move_out_review_secs": WAIT_SECS, "dispute_secs": WAIT_SECS,
            },
        }))
        .transact()
        .await?
        .into_result()?;

    // Register with the token (minting 0 registers the account).
    for id in [handova.id(), landlord.id(), mum.id()] {
        usdc.call("mint").args_json(json!({ "account_id": id, "amount": "0" })).transact().await?.into_result()?;
    }
    usdc.call("mint")
        .args_json(json!({ "account_id": nurse.id(), "amount": (2_000 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;

    Ok(Env { worker, usdc, handova, landlord, nurse, mum })
}

async fn ft_balance(e: &Env, who: &Account) -> anyhow::Result<u128> {
    let v: String = e.usdc.view("ft_balance_of").args_json(json!({ "account_id": who.id() })).await?.json()?;
    Ok(v.parse()?)
}

async fn lease(e: &Env, id: u64) -> anyhow::Result<Value> {
    Ok(e.handova.view("get_lease").args_json(json!({ "lease_id": id })).await?.json()?)
}

/// The contract always holds at least what it owes.
async fn assert_solvent(e: &Env) -> anyhow::Result<()> {
    let cfg: Value = e.handova.view("get_config").await?.json()?;
    let held: u128 = cfg["total_held"].as_str().unwrap().parse()?;
    let v: String = e.usdc.view("ft_balance_of").args_json(json!({ "account_id": e.handova.id() })).await?.json()?;
    assert_eq!(v.parse::<u128>()?, held, "contract USDC balance must equal what it owes");
    Ok(())
}

/// Pay for a home with the terms every test listing has.
async fn pay(e: &Env, from: &Account, amount: u128, mut msg: Value) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    msg["rent"] = RENT.to_string().into();
    msg["caution"] = CAUTION.to_string().into();
    msg["term_months"] = 12.into();
    Ok(from
        .call(e.usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": e.handova.id(), "amount": amount.to_string(), "msg": msg.to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?)
}

async fn create_listing(e: &Env, landlord: &Account) -> anyhow::Result<u64> {
    Ok(landlord
        .call(e.handova.id(), "create_listing")
        .args_json(json!({ "rent": RENT.to_string(), "caution": CAUTION.to_string(), "term_months": 12, "property_ref": "yaba-2bed" }))
        .transact()
        .await?
        .into_result()?
        .json()?)
}

#[tokio::test]
async fn diaspora_pays_mum_moves_in_landlord_paid_caution_returns() -> anyhow::Result<()> {
    let e = setup().await?;
    let listing = create_listing(&e, &e.landlord).await?;

    // A bad msg: the token contract refunds everything.
    let r = pay(&e, &e.nurse, RENT + CAUTION, json!({ "listing": listing })).await?;
    assert!(r.is_success(), "ft_transfer_call itself succeeds; the refund happens in ft_resolve_transfer");
    assert_eq!(ft_balance(&e, &e.nurse).await?, 2_000 * USDC);

    // The nurse in London pays for mum; 1 USDC too much comes back.
    let r = pay(&e, &e.nurse, RENT + CAUTION + USDC, json!({ "listing_id": listing, "tenant": e.mum.id() })).await?;
    assert!(r.is_success(), "{:?}", r.failures());
    assert!(r.logs().iter().any(|l| l.contains(r#""event":"lease_paid""#)));
    assert_eq!(ft_balance(&e, &e.nurse).await?, 2_000 * USDC - RENT - CAUTION);
    assert_eq!(lease(&e, 1).await?["status"], "Pending");
    assert_solvent(&e).await?;

    // Mum confirms she moved in: rent to the landlord, lease NFT to mum.
    e.mum.call(e.handova.id(), "confirm_move_in").args_json(json!({ "lease_id": 1 })).transact().await?.into_result()?;
    let token: Value = e.handova.view("nft_token").args_json(json!({ "token_id": "1" })).await?.json()?;
    assert_eq!(token["owner_id"], e.mum.id().to_string());
    assert!(token["metadata"]["extra"].as_str().unwrap().contains(r#""caution_held":"150000000""#));

    e.landlord.call(e.handova.id(), "withdraw").args_json(json!({})).max_gas().transact().await?.into_result()?;
    assert_eq!(ft_balance(&e, &e.landlord).await?, RENT, "landlord paid in full — no agent fee");
    assert_solvent(&e).await?;

    // Move-out; landlord silent; anyone triggers the refund after the review window.
    e.mum.call(e.handova.id(), "move_out").args_json(json!({ "lease_id": 1 })).transact().await?.into_result()?;
    let early = e.nurse.call(e.handova.id(), "claim_caution").args_json(json!({ "lease_id": 1 })).transact().await?;
    assert!(early.is_failure(), "review window still open");
    e.worker.fast_forward(20).await?;
    e.nurse.call(e.handova.id(), "claim_caution").args_json(json!({ "lease_id": 1 })).transact().await?.into_result()?;
    e.mum.call(e.handova.id(), "withdraw").args_json(json!({})).max_gas().transact().await?.into_result()?;
    assert_eq!(ft_balance(&e, &e.mum).await?, CAUTION, "caution came back to the NFT holder");
    assert_eq!(lease(&e, 1).await?["status"], "Closed");
    assert_solvent(&e).await?;
    Ok(())
}

#[tokio::test]
async fn nft_transfer_moves_the_caution_and_dispute_times_out_50_50() -> anyhow::Result<()> {
    let e = setup().await?;
    let listing = create_listing(&e, &e.landlord).await?;
    pay(&e, &e.nurse, RENT + CAUTION, json!({ "listing_id": listing })).await?.into_result()?;
    e.nurse.call(e.handova.id(), "confirm_move_in").args_json(json!({ "lease_id": 1 })).transact().await?.into_result()?;

    // Without the landlord's consent the lease NFT can't move.
    let unconsented = e
        .nurse
        .call(e.handova.id(), "nft_transfer")
        .args_json(json!({ "receiver_id": e.mum.id(), "token_id": "1" }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(unconsented.is_failure(), "a lease never moves without the landlord");
    // Offer (free), mum asks, the landlord agrees to mum.
    e.nurse.call(e.handova.id(), "offer_takeover").args_json(json!({ "lease_id": 1, "price": "0" })).transact().await?.into_result()?;
    e.mum.call(e.handova.id(), "request_takeover").args_json(json!({ "lease_id": 1 })).transact().await?.into_result()?;
    e.landlord.call(e.handova.id(), "consent_takeover").args_json(json!({ "lease_id": 1, "buyer": e.mum.id() })).transact().await?.into_result()?;

    // NEP-171 transfer needs exactly 1 yoctoNEAR.
    e.nurse
        .call(e.handova.id(), "nft_transfer")
        .args_json(json!({ "receiver_id": e.mum.id(), "token_id": "1" }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(lease(&e, 1).await?["nft_holder"], e.mum.id().to_string());

    e.mum.call(e.handova.id(), "move_out").args_json(json!({ "lease_id": 1 })).transact().await?.into_result()?;
    let locked = e
        .mum
        .call(e.handova.id(), "nft_transfer")
        .args_json(json!({ "receiver_id": e.nurse.id(), "token_id": "1" }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(locked.is_failure(), "NFT is locked during move-out review");

    e.landlord
        .call(e.handova.id(), "dispute_caution")
        .args_json(json!({ "lease_id": 1, "landlord_claim": CAUTION.to_string(), "reason": "Broken door" }))
        .transact()
        .await?
        .into_result()?;
    e.worker.fast_forward(20).await?;
    e.nurse.call(e.handova.id(), "settle_dispute_timeout").args_json(json!({ "lease_id": 1 })).transact().await?.into_result()?;

    let mum_bal: String = e.handova.view("balance_of").args_json(json!({ "account_id": e.mum.id() })).await?.json()?;
    let nurse_bal: String = e.handova.view("balance_of").args_json(json!({ "account_id": e.nurse.id() })).await?.json()?;
    assert_eq!(mum_bal, (CAUTION / 2).to_string(), "half the caution to the current NFT holder");
    assert_eq!(nurse_bal, "0", "the previous holder gets nothing");
    assert_solvent(&e).await?;
    Ok(())
}

#[tokio::test]
async fn failed_withdrawal_keeps_the_money() -> anyhow::Result<()> {
    let e = setup().await?;
    // This landlord never registered with the token contract, so a transfer to them fails.
    let unregistered = account(&e.worker, "newlandlord").await?;
    let listing = create_listing(&e, &unregistered).await?;
    pay(&e, &e.nurse, RENT + CAUTION, json!({ "listing_id": listing })).await?.into_result()?;
    e.nurse.call(e.handova.id(), "confirm_move_in").args_json(json!({ "lease_id": 1 })).transact().await?.into_result()?;

    let r = unregistered.call(e.handova.id(), "withdraw").args_json(json!({})).max_gas().transact().await?;
    assert!(r.logs().iter().any(|l| l.contains("withdraw_failed")), "{:?}", r.logs());
    let bal: String = e.handova.view("balance_of").args_json(json!({ "account_id": unregistered.id() })).await?.json()?;
    assert_eq!(bal, RENT.to_string(), "balance restored after the failed transfer");
    assert_solvent(&e).await?;
    Ok(())
}

/// `LEASE_RESERVE_BYTES` must cover everything one lease can store once it is open: longest account
/// names, longest listing details, both dispute reasons, three new balances and index entries.
#[tokio::test]
async fn worst_case_lease_fits_its_reserve() -> anyhow::Result<()> {
    let e = setup().await?;
    let long = |c: &str| c.repeat(64 - ".test.near".len());
    let landlord = account(&e.worker, &long("a")).await?;
    let tenant = account(&e.worker, &long("b")).await?;
    let payer = account(&e.worker, &long("c")).await?;
    e.usdc.call("mint").args_json(json!({ "account_id": payer.id(), "amount": (RENT + CAUTION).to_string() })).transact().await?.into_result()?;
    let listing: u64 = landlord
        .call(e.handova.id(), "create_listing")
        .args_json(json!({ "rent": RENT.to_string(), "caution": CAUTION.to_string(), "term_months": 12, "property_ref": "x".repeat(1024) }))
        .transact()
        .await?
        .into_result()?
        .json()?;
    let reason = "y".repeat(500);
    let before = e.handova.view_account().await?.storage_usage;

    pay(&e, &payer, RENT + CAUTION, json!({ "listing_id": listing, "tenant": tenant.id() })).await?.into_result()?;
    landlord.call(e.handova.id(), "mark_handover").args_json(json!({ "lease_id": 1 })).transact().await?.into_result()?;
    tenant.call(e.handova.id(), "dispute_move_in").args_json(json!({ "lease_id": 1, "reason": reason })).transact().await?.into_result()?;
    tenant.call(e.handova.id(), "confirm_move_in").args_json(json!({ "lease_id": 1 })).max_gas().transact().await?.into_result()?;
    tenant.call(e.handova.id(), "move_out").args_json(json!({ "lease_id": 1 })).transact().await?.into_result()?;
    landlord
        .call(e.handova.id(), "dispute_caution")
        .args_json(json!({ "lease_id": 1, "landlord_claim": "1", "reason": reason }))
        .transact()
        .await?
        .into_result()?;
    tenant.call(e.handova.id(), "propose_split").args_json(json!({ "lease_id": 1, "landlord_amount": "1" })).transact().await?.into_result()?;
    assert_eq!(lease(&e, 1).await?["status"], "Closed");

    let grew = e.handova.view_account().await?.storage_usage - before;
    println!("worst-case lease stored {grew} bytes");
    assert!(grew <= 4096, "a lease stored {grew} bytes, more than LEASE_RESERVE_BYTES");
    Ok(())
}

/// A payment for terms the listing no longer has is refused, and the USDC goes back to the payer.
#[tokio::test]
async fn payment_refused_for_changed_terms_refunds_the_payer() -> anyhow::Result<()> {
    let e = setup().await?;
    let listing = create_listing(&e, &e.landlord).await?;
    e.landlord
        .call(e.handova.id(), "update_listing")
        .args_json(json!({ "listing_id": listing, "term_months": 1 }))
        .transact()
        .await?
        .into_result()?;
    let start = ft_balance(&e, &e.nurse).await?;
    pay(&e, &e.nurse, RENT + CAUTION, json!({ "listing_id": listing })).await?;
    assert_eq!(ft_balance(&e, &e.nurse).await?, start, "the token contract refunds a refused payment");
    let cfg: Value = e.handova.view("get_config").await?.json()?;
    assert_eq!(cfg["leases"], 0);
    assert_solvent(&e).await?;
    Ok(())
}
