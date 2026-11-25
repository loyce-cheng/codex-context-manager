"""Align the local package versions in the published 0.171.0-alpha.13 source tag."""
import argparse
import hashlib
from pathlib import Path


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path, help="independent Codex source checkout")
    args = parser.parse_args()
    path = args.checkout / "codex-rs" / "Cargo.lock"
    source = path.read_text("utf-8")
    expected = "7cba7257e25ff5928bc2bc495802d6e7d60b2ebbea2f9556121dc0b5eed59465"
    if digest(source) == expected:
        print("Release lock already matches Cargo.")
        return
    if digest(source) != "22addd65bdcf713e570e3e48fa852dda6f3e66cebb0682e029a606239a4fa262":
        parser.error("lockfile differs from the pinned source tag")
    records = source.split("[[package]]")
    for index, record in enumerate(records[1:], start=1):
        if "\nsource = " not in record:
            records[index] = record.replace('\nversion = "0.0.0"', '\nversion = "0.171.0-alpha.13"', 1)
    updated = "[[package]]".join(records)
    # Exact bytes of Cargo 1.99.1's offline resolution with the tagged manifests.
    if digest(updated) != expected:
        parser.error("normalization differs from Cargo's verified output")
    path.write_bytes(updated.encode("utf-8"))
    print("Aligned the 174 local package versions with the source tag.")


if __name__ == "__main__":
    main()
