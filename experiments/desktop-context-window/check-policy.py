"""Run the patched policy and the pinned upstream window arithmetic with rustc alone."""
import argparse
from contextlib import nullcontext
import json
from pathlib import Path
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path)
    parser.add_argument("--rustc", default="rustc")
    parser.add_argument("--build-dir", type=Path, help="keep the generated test in a writable build directory")
    args = parser.parse_args()
    revision = subprocess.check_output(
        ["git", "-C", str(args.checkout), "rev-parse", "HEAD"], text=True
    ).strip()
    if revision not in {
        "226fa88979b1a9d76dc36f339ee9c5fbdb2c8e7f",
        "c376cf7396eff83ce4c6ac61b9553df142e7a0be",
        "581161ab41e643d942e1e1b5f561034060bf18e3",
    }:
        parser.error("use the documented upstream revision")

    crates = args.checkout.resolve() / "codex-rs"
    policy = crates / "core/src/session/thread_window.rs"
    models = json.loads((crates / "models-manager/models.json").read_text("utf-8"))
    astra = next(model for model in models["models"] if model["slug"] == "gpt-6-astra")
    source = (crates / "protocol/src/openai_models.rs").read_text("utf-8")
    start = source.index("impl ModelInfo {\n    pub fn resolved_context_window")
    end = source.index("\n}", start) + 2
    percent_start = source.index("const fn default_effective_context_window_percent()")
    percent_end = source.index("\n}", percent_start) + 2
    percent = astra.get("effective_context_window_percent", "default_effective_context_window_percent()")
    # Compile the upstream methods verbatim against their four input fields.
    # Transport, model execution, and session lifecycle are covered by the Cargo tests.
    harness = f"""
#[path = {json.dumps(policy.as_posix(), ensure_ascii=False)}]
mod thread_window;

struct ModelInfo {{
    context_window: Option<i64>,
    max_context_window: Option<i64>,
    effective_context_window_percent: i64,
    auto_compact_token_limit: Option<i64>,
}}
{source[percent_start:percent_end]}
{source[start:end]}
#[test]
fn astra_default_and_512k_with_native_compaction_cap() {{
    let mut info = ModelInfo {{
        context_window: Some({astra["context_window"]}),
        max_context_window: Some({astra["max_context_window"]}),
        effective_context_window_percent: {percent},
        auto_compact_token_limit: None,
    }};
    assert_eq!(info.usable_context_window(), Some(258_400));
    let selection = thread_window::ThreadWindow {{ model: "gpt-6-astra".into(), raw_tokens: 512_000 }};
    info.auto_compact_token_limit = Some(selection.compact_target("gpt-6-astra",
        info.context_window, info.max_context_window, info.effective_context_window_percent).unwrap());
    info.context_window = Some(selection.raw_tokens);
    assert_eq!(info.resolved_context_window(), Some(512_000));
    assert_eq!(info.usable_context_window(), Some(486_400));
    assert_eq!(info.auto_compact_token_limit(), Some(460_800));
}}
"""
    if args.build_dir:
        args.build_dir.mkdir(parents=True, exist_ok=True)
    output = nullcontext(args.build_dir) if args.build_dir else tempfile.TemporaryDirectory(prefix="context-window-check-")
    with output as directory:
        src = Path(directory) / "policy_check.rs"
        binary = Path(directory) / "policy_check.exe"
        src.write_text(harness, encoding="utf-8")
        subprocess.run([args.rustc, "--edition=2024", "--test", src, "-o", binary], check=True)
        subprocess.run([binary], check=True)


if __name__ == "__main__":
    main()
