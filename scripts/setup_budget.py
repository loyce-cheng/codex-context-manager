"""Check the full offline Windows installer against the stable release size budget."""
from pathlib import Path
import argparse

FINAL_LIMIT_BYTES = 100_000_000


def require_final_size(size):
    if size <= 0:
        raise ValueError("Installer is empty.")
    if size >= FINAL_LIMIT_BYTES:
        reduction = size - FINAL_LIMIT_BYTES + 1
        raise ValueError(f"Full installer is {size:,} bytes; remove at least {reduction:,} bytes to finish below 100 MB.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("installer", type=Path)
    args = parser.parse_args()
    try:
        if args.installer.suffix.lower() != ".exe" or not args.installer.is_file():
            raise ValueError("Pass a regular Windows installer EXE.")
        size = args.installer.stat().st_size
        require_final_size(size)
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    print(f"Full offline installer: {size:,} bytes, below 100 MB.")
