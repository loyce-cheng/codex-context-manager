"""Add the optional desktop preference reader to the patched 0.171.0-alpha.13 tree."""
import argparse
from pathlib import Path


def prepare(root):
    processors = root / "codex-rs/app-server/src/request_processors"
    processor = processors / "turn_processor.rs"
    text = processor.read_text(encoding="utf-8")
    entry = 'mod desktop_tiers;'
    first = '        let turn_has_input = !params.input.is_empty();'
    submit = '        let submission = thread\n            .start_or_steer_turn('
    call = """        if turn_has_input {
            desktop_tiers::apply(
                self.config.codex_home.as_path(),
                thread_id,
                thread.as_ref(),
                tier_model.as_deref(),
            )
            .await;
        }
"""
    module = processors / "turn_processor/desktop_tiers.rs"
    source = Path(__file__).with_name("desktop_tiers.rs").read_bytes()
    if 'async fn thread_context_window_set(' not in text:
        raise SystemExit("Apply the matching Context Lens backend patch first.")
    if entry in text:
        if call not in text or not module.exists() or module.read_bytes() != source:
            raise SystemExit("The desktop overlay differs from this version.")
        return
    if text.count(first) != 1 or text.count(submit) != 1 or module.exists():
        raise SystemExit("The turn entry point does not match the expected source.")
    text = entry + '\n' + text.replace(first, first+'\n        let tier_model = params.model.clone();')
    module.parent.mkdir(exist_ok=True)
    module.write_bytes(source)
    processor.write_text(text.replace(submit, call + submit), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path)
    prepare(parser.parse_args().checkout)
