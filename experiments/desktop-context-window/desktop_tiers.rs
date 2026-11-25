//! Optional local desktop integration. Read the selected thread's small preference
//! only when its normal turn/start has passed the app-server ownership checks.
use codex_core::CodexThread;
use codex_protocol::ThreadId;
use serde::Deserialize;
use std::path::Path;
use tokio::io::AsyncReadExt;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Tier {
    thread_id: String,
    expected_model: String,
    selection: codex_app_server_protocol::ThreadContextWindowSelection,
}

pub(super) async fn apply(
    codex_home: &Path,
    id: ThreadId,
    thread: &CodexThread,
    turn_model: Option<&str>,
) {
    if std::env::var_os("CONTEXT_LENS_DESKTOP_TIERS").as_deref() != Some("1".as_ref()) {
        return;
    }
    let id = id.to_string();
    let file = codex_home.join("context-lens-desktop-tiers-v1").join(format!("{id}.json"));
    let Ok(metadata) = tokio::fs::symlink_metadata(&file).await else { return };
    if !metadata.is_file() || metadata.len() > 1024 {
        return;
    }
    let Ok(file) = tokio::fs::File::open(file).await else { return };
    let mut bytes = Vec::new();
    if file.take(1025).read_to_end(&mut bytes).await.is_err() || bytes.len() > 1024 {
        return;
    }
    let Ok(tier) = serde_json::from_slice::<Tier>(&bytes) else { return };
    if tier.thread_id != id || turn_model.is_some_and(|model| model != tier.expected_model) {
        return;
    }
    let tokens = match tier.selection {
        codex_app_server_protocol::ThreadContextWindowSelection::Default => None,
        codex_app_server_protocol::ThreadContextWindowSelection::Tokens(tokens) => Some(tokens),
    };
    if let Err(reason) = thread.set_context_window(&tier.expected_model, tokens).await {
        tracing::debug!(reason, "Context Lens desktop tier was not applied");
    }
}
