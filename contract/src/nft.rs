//! NEP-171 lease NFT. Token id = lease id.
//!
//! The caution fee never leaves this contract; it belongs to whoever owns the token. The token
//! can change hands only while the lease is `Active`, and only to the person the landlord agreed
//! to (see market.rs: offer → request → consent): a direct transfer, a transfer call or a
//! marketplace sale to anyone else is refused. During move-out review, a dispute, and after close it is locked — once closed it stays
//! with the tenant as proof of a finished lease (a rental history).
//!
//! Metadata is not stored: every view builds it from the lease, so wallets always show the live
//! status and the caution the token holds.

use std::collections::HashMap;

use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{NonFungibleTokenCore, NonFungibleTokenResolver};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId, Promise, PromiseOrValue};

use crate::{events, svg, Contract, ContractExt, LeaseStatus};

#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        let lease_id = self.assert_transferable(&token_id);
        self.assert_consented_receiver(lease_id, &receiver_id);
        self.nft.nft_transfer(receiver_id.clone(), token_id, approval_id, memo);
        self.hand_over(lease_id, &receiver_id);
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        let lease_id = self.assert_transferable(&token_id);
        self.assert_consented_receiver(lease_id, &receiver_id);
        // The receiver becomes the tenant in nft_resolve_transfer, only if they keep the token;
        // if they hand it back, the holder keeps the lease and the landlord's consent stands.
        self.nft.nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.nft.nft_token(token_id).map(|t| self.live(t))
    }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        let kept = self.nft.nft_resolve_transfer(previous_owner_id, receiver_id.clone(), token_id.clone(), approved_account_ids);
        if kept {
            if let Ok(lease_id) = token_id.parse::<u64>() {
                self.hand_over(lease_id, &receiver_id);
            }
        }
        kept
    }
}

/// NEP-178: let a marketplace move the lease for its holder. Only while the lease is active;
/// every approval is cleared when the NFT changes hands.
#[near]
impl NonFungibleTokenApproval for Contract {
    #[payable]
    fn nft_approve(&mut self, token_id: TokenId, account_id: AccountId, msg: Option<String>) -> Option<Promise> {
        self.assert_transferable(&token_id);
        self.nft.nft_approve(token_id, account_id, msg)
    }

    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.nft.nft_revoke(token_id, account_id)
    }

    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.nft.nft_revoke_all(token_id)
    }

    fn nft_is_approved(&self, token_id: TokenId, approved_account_id: AccountId, approval_id: Option<u64>) -> bool {
        self.nft.nft_is_approved(token_id, approved_account_id, approval_id)
    }
}

/// NEP-199: how a marketplace splits the sale of a lease.
#[near(serializers = [json])]
pub struct Payout {
    pub payout: HashMap<AccountId, U128>,
}

/// NEP-199 payouts, so NEAR marketplaces (e.g. Mintbase's market) can settle a lease sale. The same
/// rule as Handova's own takeover applies: the sale only goes through to the person the landlord
/// agreed to. The buyer becomes the tenant and holds the caution right.
#[near]
impl Contract {
    /// The whole sale price goes to the current holder (no royalties).
    pub fn nft_payout(&self, token_id: TokenId, balance: U128, max_len_payout: Option<u32>) -> Payout {
        require!(max_len_payout.map_or(true, |m| m >= 1), "max_len_payout must be at least 1");
        let owner = self.nft.owner_by_id.get(&token_id).unwrap_or_else(|| env::panic_str("Token not found"));
        Payout { payout: HashMap::from([(owner, balance)]) }
    }

    #[payable]
    pub fn nft_transfer_payout(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        balance: U128,
        max_len_payout: Option<u32>,
    ) -> Payout {
        let lease_id = self.assert_transferable(&token_id);
        let holder = self.holder(lease_id);
        self.assert_consented_receiver(lease_id, &receiver_id);
        let payout = self.nft_payout(token_id.clone(), balance, max_len_payout);
        // Checks the 1 yocto, the owner or the marketplace's approval; clears approvals; emits nft_transfer.
        self.nft.nft_transfer(receiver_id.clone(), token_id, approval_id, memo);
        self.hand_over(lease_id, &receiver_id);
        events::emit(
            "lease_taken_over",
            json!({ "lease_id": lease_id, "from": holder, "to": receiver_id, "price": balance, "via": env::predecessor_account_id() }),
        );
        payout
    }
}

#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 {
        self.nft.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.nft.nft_tokens(from_index, limit).into_iter().map(|t| self.live(t)).collect()
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.nft.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.nft
            .nft_tokens_for_owner(account_id, from_index, limit)
            .into_iter()
            .map(|t| self.live(t))
            .collect()
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Handova Lease".to_string(),
            symbol: "LEASE".to_string(),
            icon: Some(svg::icon_data_uri()),
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}

impl Contract {
    fn assert_transferable(&self, token_id: &TokenId) -> u64 {
        let lease_id: u64 = token_id.parse().unwrap_or_else(|_| env::panic_str("Token not found"));
        let lease = self.leases.get(&lease_id).unwrap_or_else(|| env::panic_str("Token not found"));
        require!(
            lease.status == LeaseStatus::Active,
            "This lease NFT is locked: it can only change hands while the lease is active"
        );
        lease_id
    }

    /// Caution still held by the token (zero once paid out).
    pub(crate) fn caution_held(&self, status: LeaseStatus, caution: u128) -> u128 {
        match status {
            LeaseStatus::Active | LeaseStatus::Ending | LeaseStatus::Disputed => caution,
            _ => 0,
        }
    }

    fn live(&self, mut token: Token) -> Token {
        let Some(lease) = token.token_id.parse::<u64>().ok().and_then(|id| self.leases.get(&id)) else {
            return token;
        };
        let held = self.caution_held(lease.status, lease.caution.0);
        let held_str = svg::usdc(held, self.token_decimals);
        let status = format!("{:?}", lease.status);
        let description = match lease.status {
            LeaseStatus::Active => format!(
                "Lease for Handova listing #{}. This NFT holds a {} USDC caution fee in escrow. At move-out it is paid to whoever holds this NFT, unless the landlord disputes.",
                lease.listing_id, held_str
            ),
            LeaseStatus::Ending => format!(
                "Moved out. The landlord is reviewing the home; the {} USDC caution fee returns to the holder after the review.",
                held_str
            ),
            LeaseStatus::Disputed => format!(
                "Caution fee of {} USDC is disputed. It is split by agreement or by the arbiter. If neither happens, it returns to the holder, less anything they offered.",
                held_str
            ),
            _ => format!(
                "Finished lease for Handova listing #{}. Caution returned to the holder: {} USDC.",
                lease.listing_id,
                svg::usdc(lease.caution_to_holder.0, self.token_decimals)
            ),
        };
        token.metadata = Some(TokenMetadata {
            title: Some(format!("Handova lease #{} · {}", lease.id, status)),
            description: Some(description),
            media: Some(svg::lease_data_uri(lease, held, self.token_decimals)),
            media_hash: None,
            copies: Some(1),
            issued_at: None,
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: Some(
                json!({
                    "status": status,
                    "listing_id": lease.listing_id,
                    "landlord": lease.landlord,
                    "tenant": lease.tenant,
                    "rent": lease.rent,
                    "caution": lease.caution,
                    "caution_held": U128(held),
                    "moved_in_at_ms": lease.moved_in_at_ms,
                    "ends_at_ms": lease.ends_at_ms,
                    "caution_to_holder": lease.caution_to_holder,
                    "caution_to_landlord": lease.caution_to_landlord,
                    "takeover_price": lease.takeover.as_ref().map(|t| t.price),
                })
                .to_string(),
            ),
            reference: None,
            reference_hash: None,
        });
        token
    }
}
