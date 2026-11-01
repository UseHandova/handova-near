//! NEP-297 events, so an indexer (or our server) can follow every lease without polling.

use near_sdk::serde_json::{json, Value};

pub fn emit(event: &str, data: Value) {
    near_sdk::log!(
        "EVENT_JSON:{}",
        json!({ "standard": "handova", "version": "1.0.0", "event": event, "data": [data] })
    );
}
