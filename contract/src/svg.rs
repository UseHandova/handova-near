//! The lease NFT's picture, drawn on-chain from the lease state.

use base64::Engine;

use crate::{Lease, LeaseStatus};

/// `1500000` with 6 decimals → `"1.50"`.
pub fn usdc(amount: u128, decimals: u8) -> String {
    let unit = 10u128.pow(decimals as u32);
    let cents = amount * 100 / unit;
    format!("{}.{:02}", cents / 100, cents % 100)
}

fn data_uri(svg: &str) -> String {
    format!("data:image/svg+xml;base64,{}", base64::engine::general_purpose::STANDARD.encode(svg))
}

pub fn icon_data_uri() -> String {
    data_uri(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0A6638"/><path d="M14 32 32 16l18 16v18H38V38H26v12H14z" fill="#fff"/></svg>"##,
    )
}

pub fn lease_data_uri(lease: &Lease, held: u128, decimals: u8) -> String {
    let (label, color) = match lease.status {
        LeaseStatus::Pending => ("Waiting for move-in", "#64748B"),
        LeaseStatus::Active => ("Active", "#0A6638"),
        LeaseStatus::Ending => ("Move-out review", "#B45309"),
        LeaseStatus::Disputed => ("Caution disputed", "#B91C1C"),
        LeaseStatus::Closed => ("Finished", "#334155"),
        LeaseStatus::Cancelled => ("Cancelled", "#64748B"),
    };
    let held_line = if held > 0 {
        format!("Caution held: {} USDC", usdc(held, decimals))
    } else {
        format!("Caution returned: {} USDC", usdc(lease.caution_to_holder.0, decimals))
    };
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" font-family="Helvetica,Arial,sans-serif"><rect width="400" height="400" rx="24" fill="#F8FAFC"/><rect width="400" height="96" rx="24" fill="{color}"/><rect y="72" width="400" height="24" fill="{color}"/><path d="M32 50 52 32l20 18v20H60V58H44v12H32z" fill="#fff"/><text x="88" y="58" fill="#fff" font-size="26" font-weight="700">Handova lease #{id}</text><text x="32" y="150" fill="#0F172A" font-size="22" font-weight="700">{label}</text><text x="32" y="200" fill="#334155" font-size="18">Listing #{listing}</text><text x="32" y="235" fill="#334155" font-size="18">Rent paid: {rent} USDC</text><text x="32" y="270" fill="#0F172A" font-size="20" font-weight="700">{held_line}</text><text x="32" y="360" fill="#64748B" font-size="14">Rent escrow on NEAR · no agent fee</text></svg>"##,
        color = color,
        id = lease.id,
        label = label,
        listing = lease.listing_id,
        rent = usdc(lease.rent.0, decimals),
        held_line = held_line,
    );
    data_uri(&svg)
}
