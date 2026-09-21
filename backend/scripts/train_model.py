"""Fine-tune EfficientNet-B0 for crop-disease classification.

Offline job — never imported by the running API. The API only *loads* the
checkpoint this produces (`app/models/loader.py`).

Two modes
---------
``--mode head`` (default, CPU-friendly)
    Freeze the ImageNet-pretrained backbone, cache its features once, then train
    only the classifier head. On a 12-core CPU this finishes in minutes and
    reaches high accuracy on PlantVillage, because the frozen features are
    already very discriminative for leaf imagery.

``--mode full``
    Unfreeze the whole network and fine-tune end to end. Better ceiling, but
    wants a GPU — on CPU this is hours, not minutes.

Both modes save the *same* checkpoint format (full `state_dict` plus metadata),
so `loader.py` does not care which was used.

Usage
-----
    python scripts/train_model.py --data-root ~/.workbuddy-ai/datasets/plantvillage/extracted
    python scripts/train_model.py --mode full --epochs 8 --data-root ...

The checkpoint is written to `MODEL_PATH` (default
`app/models/weights/efficientnet_b0_agri.pt`).

The trained model is used for image diagnosis ONLY — it is never wired to the
LLM, per the project's non-negotiable architectural constraint.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

# Make `app.*` importable when run as a script from backend/.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models.labels import (  # noqa: E402
    DISEASE_CLASSES,
    IMAGENET_MEAN,
    IMAGENET_STD,
    INPUT_SIZE,
)

# ---------------------------------------------------------------------------
# PlantVillage folder name -> our taxonomy string.
# The folder spellings are inconsistent in the original dataset (single vs double
# vs triple underscores), so they are listed explicitly rather than derived.
# ---------------------------------------------------------------------------
CLASS_FOLDERS: dict[str, str] = {
    "Tomato___Early_blight": "Tomato - Early Blight",
    "Tomato___Late_blight": "Tomato - Late Blight",
    "Tomato___Leaf_Mold": "Tomato - Leaf Mold",
    "Tomato___Septoria_leaf_spot": "Tomato - Septoria Leaf Spot",
    "Tomato___healthy": "Tomato - Healthy",
    "Potato___Early_blight": "Potato - Early Blight",
    "Potato___Late_blight": "Potato - Late Blight",
    "Potato___healthy": "Potato - Healthy",
    "Pepper__bell___Bacterial_spot": "Pepper - Bacterial Spot",
    "Pepper__bell___healthy": "Pepper - Healthy",
}

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG"}


def _normalise(name: str) -> str:
    """Reduce a class folder name to a comparable key.

    The upstream dataset is inconsistent: the same class appears as
    `Pepper__bell___Bacterial_spot` in some releases and
    `Pepper,_bell___Bacterial_spot` in others. Stripping everything that is not
    alphanumeric and lower-casing makes the lookup immune to that.
    """
    return "".join(ch for ch in name.lower() if ch.isalnum())


# normalised folder name -> (canonical folder key, taxonomy string)
NORMALISED_CLASS_FOLDERS: dict[str, tuple[str, str]] = {
    _normalise(folder): (folder, disease) for folder, disease in CLASS_FOLDERS.items()
}


def find_class_dirs(root: Path) -> dict[str, Path]:
    """Locate the class folders anywhere under `root`.

    Keyed by normalised folder name. The upstream zip has changed both its
    internal layout and its folder spellings between releases, so this searches
    rather than assuming either.
    """
    found: dict[str, Path] = {}
    for path in root.rglob("*"):
        if not path.is_dir():
            continue
        key = _normalise(path.name)
        if key in NORMALISED_CLASS_FOLDERS and key not in found:
            found[key] = path
    return found


def collect_samples(
    class_dirs: dict[str, Path], *, max_per_class: int, seed: int
) -> list[tuple[Path, int]]:
    """Build a shuffled (image_path, class_index) list, capped per class."""
    name_to_index = {c.disease_name: c.index for c in DISEASE_CLASSES}
    rng = random.Random(seed)
    samples: list[tuple[Path, int]] = []

    for key, (folder, disease_name) in sorted(NORMALISED_CLASS_FOLDERS.items()):
        directory = class_dirs.get(key)
        if directory is None:
            print(f"  !! missing class folder: {folder}")
            continue

        images = sorted(p for p in directory.iterdir() if p.suffix in IMAGE_SUFFIXES)
        rng.shuffle(images)
        if max_per_class > 0:
            images = images[:max_per_class]

        samples.extend((p, name_to_index[disease_name]) for p in images)
        print(f"  {disease_name:<32} {len(images):>5} images")

    rng.shuffle(samples)
    return samples


def stratified_split(
    samples: list[tuple[Path, int]], *, val_fraction: float, seed: int
) -> tuple[list, list]:
    """Split into train/val while keeping each class represented in both."""
    rng = random.Random(seed)
    by_label: dict[int, list] = {}
    for item in samples:
        by_label.setdefault(item[1], []).append(item)

    train, val = [], []
    for items in by_label.values():
        rng.shuffle(items)
        cut = max(1, int(len(items) * val_fraction))
        val.extend(items[:cut])
        train.extend(items[cut:])

    rng.shuffle(train)
    rng.shuffle(val)
    return train, val


def make_transform(train: bool):
    """Preprocessing pipeline, matching `app/models/preprocessing.py`."""
    from torchvision import transforms

    if train:
        return transforms.Compose(
            [
                transforms.RandomResizedCrop(INPUT_SIZE, scale=(0.7, 1.0)),
                transforms.RandomHorizontalFlip(),
                transforms.RandomVerticalFlip(),
                transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
                transforms.ToTensor(),
                transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
            ]
        )
    return transforms.Compose(
        [
            transforms.Resize(int(INPUT_SIZE * 1.14)),
            transforms.CenterCrop(INPUT_SIZE),
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ]
    )


def extract_features(samples, *, batch_size: int, workers: int, desc: str):
    """Run the frozen backbone over a dataset and cache the pooled features."""
    import numpy as np
    import torch
    from torch.utils.data import DataLoader
    from torchvision.models import EfficientNet_B0_Weights, efficientnet_b0

    # NOTE: the dataset class must live at module level. On Windows, DataLoader
    # workers are spawned (not forked) and the dataset is pickled to each child —
    # a class defined inside this function cannot be pickled.
    backbone = efficientnet_b0(weights=EfficientNet_B0_Weights.IMAGENET1K_V1)
    # Everything except the classifier head becomes the frozen feature extractor.
    backbone.classifier = torch.nn.Identity()
    backbone.eval()

    loader = DataLoader(
        _ImageDataset(samples, train=False),
        batch_size=batch_size,
        shuffle=False,
        num_workers=workers,
        persistent_workers=workers > 0,
    )

    feats, labels = [], []
    started = time.time()
    with torch.inference_mode():
        for step, (images, targets) in enumerate(loader, 1):
            feats.append(backbone(images).numpy())
            labels.append(targets.numpy())
            if step % 20 == 0 or step == len(loader):
                done = min(step * batch_size, len(samples))
                rate = done / max(time.time() - started, 1e-6)
                print(f"    {desc}: {done}/{len(samples)} ({rate:.0f} img/s)", flush=True)

    return np.concatenate(feats), np.concatenate(labels)


class _ImageDataset:
    """Picklable dataset wrapper (defined at module level so workers can import it)."""

    def __init__(self, items, train: bool):
        self.items = items
        self.tf = make_transform(train=train)

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        from PIL import Image

        path, label = self.items[i]
        with Image.open(path) as im:
            return self.tf(im.convert("RGB")), label


def main() -> int:
    parser = argparse.ArgumentParser(description="Fine-tune EfficientNet-B0 for Agri AI")
    parser.add_argument("--data-root", type=Path, required=True, help="PlantVillage root")
    parser.add_argument("--mode", choices=["head", "full"], default="head")
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--max-per-class", type=int, default=500)
    parser.add_argument("--val-fraction", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--version", default=None)
    args = parser.parse_args()

    if not args.data_root.exists():
        print(f"Data root not found: {args.data_root}")
        return 2

    output = args.output or (
        Path(__file__).resolve().parents[1]
        / "app"
        / "models"
        / "weights"
        / "efficientnet_b0_agri.pt"
    )
    output.parent.mkdir(parents=True, exist_ok=True)

    print("=" * 74)
    print(f"Agri AI — training ({args.mode} mode)")
    print("=" * 74)
    print(f"Data root: {args.data_root}")

    class_dirs = find_class_dirs(args.data_root)
    if not class_dirs:
        print("No PlantVillage class folders found under the data root.")
        return 2

    print("\nCollecting images:")
    samples = collect_samples(class_dirs, max_per_class=args.max_per_class, seed=args.seed)
    if not samples:
        print("No images collected.")
        return 2

    train_items, val_items = stratified_split(
        samples, val_fraction=args.val_fraction, seed=args.seed
    )
    print(f"\n  train {len(train_items)}   val {len(val_items)}")

    import torch
    from torch import nn

    started = time.time()

    if args.mode == "head":
        print("\nExtracting frozen backbone features (train)…")
        x_train, y_train = extract_features(
            train_items, batch_size=args.batch_size, workers=args.workers, desc="train"
        )
        print("\nExtracting frozen backbone features (val)…")
        x_val, y_val = extract_features(
            val_items, batch_size=args.batch_size, workers=args.workers, desc="val"
        )

        xt = torch.from_numpy(x_train).float()
        yt = torch.from_numpy(y_train).long()
        xv = torch.from_numpy(x_val).float()
        yv = torch.from_numpy(y_val).long()

        head = nn.Linear(xt.shape[1], len(DISEASE_CLASSES))
        optimiser = torch.optim.AdamW(head.parameters(), lr=args.lr, weight_decay=1e-4)
        criterion = nn.CrossEntropyLoss()

        print("\nTraining classifier head:")
        best_state, best_acc = None, 0.0
        for epoch in range(1, args.epochs + 1):
            head.train()
            perm = torch.randperm(len(xt))
            total_loss = 0.0
            for i in range(0, len(xt), 512):
                idx = perm[i : i + 512]
                optimiser.zero_grad()
                loss = criterion(head(xt[idx]), yt[idx])
                loss.backward()
                optimiser.step()
                total_loss += loss.item() * len(idx)

            head.eval()
            with torch.inference_mode():
                acc = (head(xv).argmax(1) == yv).float().mean().item()

            if acc > best_acc:
                best_acc = acc
                best_state = {k: v.clone() for k, v in head.state_dict().items()}
            if epoch % 5 == 0 or epoch == args.epochs:
                print(
                    f"    epoch {epoch:>3}  loss {total_loss / len(xt):.4f}  " f"val_acc {acc:.4f}",
                    flush=True,
                )

        # Rebuild the full network and drop the trained head into it, so the saved
        # checkpoint is a complete EfficientNet-B0 either way.
        from app.models.loader import build_model

        model = build_model(len(DISEASE_CLASSES), pretrained_backbone=True)
        with torch.no_grad():
            model.classifier[1].weight.copy_(best_state["weight"])
            model.classifier[1].bias.copy_(best_state["bias"])
    else:
        from torch.utils.data import DataLoader

        from app.models.loader import build_model

        model = build_model(len(DISEASE_CLASSES), pretrained_backbone=True)
        train_loader = DataLoader(
            _ImageDataset(train_items, True),
            batch_size=args.batch_size,
            shuffle=True,
            num_workers=args.workers,
        )
        val_loader = DataLoader(
            _ImageDataset(val_items, False), batch_size=args.batch_size, num_workers=args.workers
        )

        optimiser = torch.optim.AdamW(model.parameters(), lr=args.lr * 0.1, weight_decay=1e-4)
        criterion = nn.CrossEntropyLoss()
        best_path = output.with_suffix(".best.pt")

        print("\nFine-tuning end to end:")
        best_acc = 0.0
        for epoch in range(1, args.epochs + 1):
            model.train()
            running = 0.0
            for images, targets in train_loader:
                optimiser.zero_grad()
                loss = criterion(model(images), targets)
                loss.backward()
                optimiser.step()
                running += loss.item() * len(targets)

            model.eval()
            correct = total = 0
            with torch.inference_mode():
                for images, targets in val_loader:
                    correct += (model(images).argmax(1) == targets).sum().item()
                    total += len(targets)
            acc = correct / max(total, 1)
            print(
                f"    epoch {epoch:>3}  loss {running / len(train_items):.4f}  "
                f"val_acc {acc:.4f}",
                flush=True,
            )
            if acc > best_acc:
                best_acc = acc
                torch.save(model.state_dict(), best_path)

        model.load_state_dict(torch.load(best_path, weights_only=True))

    # ---- Confusion summary on the validation split -----------------------
    print("\nEvaluating:")
    model.eval()
    val_transform = make_transform(train=False)
    from PIL import Image

    with torch.inference_mode():
        preds, truths = [], []
        for path, label in val_items:
            with Image.open(path) as im:
                tensor = val_transform(im.convert("RGB")).unsqueeze(0)
            preds.append(int(model(tensor).argmax(1).item()))
            truths.append(label)

    per_class: dict[str, dict] = {}
    for cls in DISEASE_CLASSES:
        idx = [i for i, t in enumerate(truths) if t == cls.index]
        if not idx:
            continue
        hit = sum(1 for i in idx if preds[i] == truths[i])
        per_class[cls.disease_name] = {"n": len(idx), "accuracy": round(hit / len(idx), 4)}

    overall = sum(1 for p, t in zip(preds, truths, strict=False) if p == t) / max(len(truths), 1)
    print(f"    overall val accuracy: {overall:.4f}")
    for name, stats in per_class.items():
        print(f"      {name:<32} n={stats['n']:<5} acc={stats['accuracy']:.3f}")

    # ---- Save ------------------------------------------------------------
    version = args.version or f"v1.0.0-{args.mode}"
    checkpoint = {
        "state_dict": model.state_dict(),
        "class_names": [c.disease_name for c in DISEASE_CLASSES],
        "architecture": "efficientnet_b0",
        "input_size": INPUT_SIZE,
        "model_version": version,
        "trained_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "training": {
            "mode": args.mode,
            "dataset": "PlantVillage (mohanty/PlantVillage)",
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "lr": args.lr,
            "max_per_class": args.max_per_class,
            "train_size": len(train_items),
            "val_size": len(val_items),
            "seed": args.seed,
            "device": "cpu",
            "duration_seconds": round(time.time() - started, 1),
        },
        "metrics": {"val_accuracy": round(overall, 4), "per_class": per_class},
    }
    torch.save(checkpoint, output)
    print(f"\nSaved checkpoint -> {output}")
    print(json.dumps(checkpoint["metrics"], indent=2)[:900])
    print(f"\nVersion {version} · {round(time.time() - started, 1)}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
