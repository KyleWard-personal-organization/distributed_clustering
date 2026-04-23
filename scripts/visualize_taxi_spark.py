"""
Visualize distributed clustering results (Spark pipeline output) on NYC taxi data.

Primary mode  : reads pre-computed result CSVs produced by run_experiment.py
                (columns: x, y, cluster  where cluster is "NOISE" or "GlobalCluster_N" / "Cluster_N")
Fallback mode : re-runs sklearn DBSCAN/HDBSCAN locally (same as visualize_taxi.py)

Two display modes (--mode):
    sweep : 2×3 grid — N DBSCAN result files + 1 HDBSCAN result file (no basemap)
    map   : 1×K panel — selected results on an OpenStreetMap basemap + landmarks

Result-file discovery (--results-dir, default: data/):
    Looks for files matching  <prefix>_dbscan_results_eps*.csv  and
                              <prefix>_hdbscan_results_mc*.csv
    You can also pass explicit files via --dbscan-files / --hdbscan-file.

Fallback (--fallback):
    If no result files are found, runs sklearn locally using --eps-sweep / --eps-map.

Usage examples:
    # Auto-discover results in data/ and plot sweep
    python visualize_taxi_spark.py --data data/taxi_2000.csv --mode sweep

    # Explicit result files
    python visualize_taxi_spark.py \\
        --dbscan-files data/taxi_2000_dbscan_results_eps0.001_ms5.csv \\
                       data/taxi_2000_dbscan_results_eps0.002_ms5.csv \\
        --hdbscan-file data/taxi_2000_hdbscan_results_mc30_ms5.csv \\
        --mode sweep

    # Map mode with basemap
    python visualize_taxi_spark.py --data data/taxi_2000.csv --mode map

    # Force sklearn fallback (same as visualize_taxi.py)
    python visualize_taxi_spark.py --data data/taxi_2000.csv --mode sweep --fallback
"""
from __future__ import annotations

import argparse
import math
import os
import re
import time
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# 无论从哪个目录调用，均以项目根目录为基准解析默认路径
_PROJECT_ROOT = Path(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# ---------- NYC constants ----------
NYC_BBOX = (-74.05, -73.75, 40.58, 40.90)  # lon_min, lon_max, lat_min, lat_max
NYC_LANDMARKS = [
    ("JFK",           -73.7781, 40.6413),
    ("LaGuardia",     -73.8740, 40.7769),
    ("Times Sq",      -73.9855, 40.7580),
    ("Grand Central", -73.9772, 40.7527),
    ("Penn Station",  -73.9904, 40.7506),
    ("Wall St",       -74.0089, 40.7074),
    ("Central Park",  -73.9654, 40.7829),
    ("Williamsburg",  -73.9571, 40.7081),
    ("Brooklyn Hts",  -73.9961, 40.6959),
]


# ---------- label helpers ----------
def _parse_labels(cluster_col: pd.Series) -> np.ndarray:
    """Convert string cluster labels ('NOISE', 'GlobalCluster_3', 'Cluster_3') -> int array."""
    def _to_int(v):
        if str(v).upper() == "NOISE" or str(v) == "-1":
            return -1
        m = re.search(r"(\d+)$", str(v))
        return int(m.group(1)) if m else -1
    return np.array([_to_int(v) for v in cluster_col])


def _label_stats(labels: np.ndarray, elapsed: float) -> dict:
    nc = len(set(labels[labels != -1]))
    noise_pct = (labels == -1).mean() * 100
    biggest = 0.0
    if nc > 0:
        _, counts = np.unique(labels[labels != -1], return_counts=True)
        biggest = counts.max() / len(labels) * 100
    return dict(clusters=nc, noise=noise_pct, biggest=biggest, time=elapsed)


# ---------- basemap via contextily ----------
def fetch_basemap_contextily(bbox, zoom, cache_dir: Path):
    """
    Download basemap tiles using contextily.
    Returns (img_array, (lon_min, lon_max, lat_min, lat_max)) in WGS84.
    Tries CartoDB Positron first (more reliable), falls back to OSM.
    """
    import contextily as ctx
    from pyproj import Transformer

    cache_dir.mkdir(parents=True, exist_ok=True)

    lon_min, lon_max, lat_min, lat_max = bbox

    # Convert WGS84 → Web Mercator (EPSG:3857) for contextily
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    x_min, y_min = transformer.transform(lon_min, lat_min)
    x_max, y_max = transformer.transform(lon_max, lat_max)

    # Providers to try in order
    providers = [
        ctx.providers.CartoDB.Positron,
        ctx.providers.OpenStreetMap.Mapnik,
        ctx.providers.CartoDB.DarkMatter,
    ]

    last_err = None
    for provider in providers:
        try:
            img, extent_3857 = ctx.bounds2img(
                x_min, y_min, x_max, y_max,
                zoom=zoom, source=provider,
            )
            # extent_3857 = (left, right, bottom, top) in Web Mercator
            # convert back to WGS84 for plotting
            inv = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
            lo_l, la_b = inv.transform(extent_3857[0], extent_3857[2])
            lo_r, la_t = inv.transform(extent_3857[1], extent_3857[3])
            print(f"[map  ] basemap loaded via {provider.get('name', str(provider))}")
            return img, (lo_l, lo_r, la_b, la_t)
        except Exception as e:
            last_err = e
            continue

    raise RuntimeError(f"All basemap providers failed: {last_err}")


# ---------- drawing helpers ----------
def _cluster_size_rank_colors(labels):
    unique, counts = np.unique(labels[labels != -1], return_counts=True)
    order = unique[np.argsort(-counts)]
    rank = {c: i for i, c in enumerate(order)}
    cmap = plt.get_cmap("tab20", 20)
    colors = np.full((len(labels), 4), [0.7, 0.7, 0.7, 0.2])
    for c, i in rank.items():
        colors[labels == c] = cmap(i % 20)
    return colors


def _add_landmarks(ax, bbox, fontsize=8, marker_size=60):
    lon_min, lon_max, lat_min, lat_max = bbox
    for name, lon, lat in NYC_LANDMARKS:
        if lon_min <= lon <= lon_max and lat_min <= lat <= lat_max:
            ax.scatter([lon], [lat], s=marker_size, c="red", marker="*",
                       edgecolors="white", linewidths=1.1, zorder=6)
            ax.annotate(name, (lon, lat), xytext=(5, 5),
                        textcoords="offset points", fontsize=fontsize,
                        bbox=dict(boxstyle="round,pad=0.18",
                                  fc="white", ec="none", alpha=0.8),
                        zorder=7)


def _panel_plain(ax, X, labels, title, bbox):
    lon_min, lon_max, lat_min, lat_max = bbox
    mask = labels != -1
    ax.scatter(X[~mask, 0], X[~mask, 1], s=1.5, c="lightgray", alpha=0.4)
    if mask.any():
        ax.scatter(X[mask, 0], X[mask, 1], s=1.5, c=labels[mask],
                   cmap="tab20", alpha=0.8)
    ax.set_title(title, fontsize=10)
    ax.set_xlabel("longitude")
    ax.set_ylabel("latitude")
    ax.set_aspect("equal")
    ax.set_xlim(lon_min, lon_max)
    ax.set_ylim(lat_min, lat_max)


def _panel_map(ax, X, labels, title, basemap, extent, bbox):
    lon_min, lon_max, lat_min, lat_max = bbox
    ax.imshow(basemap, extent=extent, origin="upper", alpha=0.5, zorder=0)
    colors = _cluster_size_rank_colors(labels)
    noise = labels == -1
    ax.scatter(X[noise, 0], X[noise, 1], s=2, c="black", alpha=0.12, zorder=1)
    ax.scatter(X[~noise, 0], X[~noise, 1], s=3, c=colors[~noise],
               alpha=0.85, zorder=2)
    _add_landmarks(ax, bbox)
    ax.set_xlim(lon_min, lon_max)
    ax.set_ylim(lat_min, lat_max)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_aspect("equal")
    ax.set_title(title, fontsize=10)


# ---------- result loading ----------
def load_result_csv(csv_path: Path) -> Tuple[np.ndarray, np.ndarray, float]:
    """Returns (X, labels_int, elapsed_seconds).
    elapsed_seconds is 0.0 for pre-computed results (timing already done by Spark).
    """
    df = pd.read_csv(csv_path)
    X = df[["x", "y"]].to_numpy()
    labels = _parse_labels(df["cluster"])
    return X, labels, 0.0


def _discover_result_files(data_path: Path, results_dir: Path):
    """Auto-discover DBSCAN/HDBSCAN result CSVs matching the data file prefix."""
    stem = data_path.stem  # e.g. "taxi_2000"
    dbscan_files = sorted(results_dir.glob(f"{stem}_dbscan_results_eps*.csv"))
    hdbscan_files = sorted(results_dir.glob(f"{stem}_hdbscan_results.csv"))
    return dbscan_files, hdbscan_files


def _extract_eps_from_filename(path: Path) -> Optional[float]:
    m = re.search(r"eps([0-9.eE+\-]+)", path.stem)
    return float(m.group(1)) if m else None


def _extract_mc_from_filename(path: Path) -> Optional[int]:
    # mc no longer in filename; return None (caller handles gracefully)
    return None


# ---------- sklearn fallback ----------
def _run_sklearn_dbscan(X, eps, min_samples):
    from sklearn.cluster import DBSCAN
    t = time.perf_counter()
    labels = DBSCAN(eps=eps, min_samples=min_samples, n_jobs=-1).fit_predict(X)
    return labels, time.perf_counter() - t


def _run_sklearn_hdbscan(X, min_cluster_size, min_samples):
    from sklearn.cluster import HDBSCAN
    t = time.perf_counter()
    labels = HDBSCAN(min_cluster_size=min_cluster_size,
                     min_samples=min_samples, n_jobs=-1).fit_predict(X)
    return labels, time.perf_counter() - t


# ---------- main render functions ----------
def render_sweep(panels, out_dir: Path, n_points: int, source_tag: str):
    """panels: list of (title, X, labels_int)  — up to 6 items."""
    n = len(panels)
    ncols = 3
    nrows = math.ceil(n / ncols)
    fig, axes = plt.subplots(nrows, ncols, figsize=(6 * ncols, 5 * nrows))
    axes = np.array(axes).flatten()
    for ax, (title, X, labels) in zip(axes, panels):
        _panel_plain(ax, X, labels, title, NYC_BBOX)
    # hide unused axes
    for ax in axes[n:]:
        ax.set_visible(False)
    fig.suptitle(
        f"Distributed Clustering Results ({source_tag})  |  "
        f"NYC Yellow Taxi pickups, n={n_points:,}",
        fontsize=13, y=1.01)
    plt.tight_layout()
    out = out_dir / f"spark_sweep_{n_points}.png"
    plt.savefig(out, dpi=140, bbox_inches="tight")
    print(f"[plot] saved {out}")
    plt.close(fig)


def render_map(panels, out_dir: Path, n_points: int, source_tag: str, zoom: int):
    """panels: list of (title, X, labels_int)"""
    basemap, extent = fetch_basemap_contextily(NYC_BBOX, zoom=zoom,
                                               cache_dir=out_dir / "tiles")
    k = len(panels)
    fig, axes = plt.subplots(1, k, figsize=(6 * k, 8))
    if k == 1:
        axes = [axes]
    for ax, (title, X, labels) in zip(axes, panels):
        _panel_map(ax, X, labels, title, basemap, extent, NYC_BBOX)
    fig.suptitle(
        f"Distributed DBSCAN vs HDBSCAN on OSM  ({source_tag})  n={n_points:,}",
        fontsize=13, y=1.01)
    plt.tight_layout()
    out = out_dir / f"spark_map_{n_points}.png"
    plt.savefig(out, dpi=140, bbox_inches="tight")
    print(f"[plot] saved {out}")
    plt.close(fig)


# ---------- panel builder ----------
def build_panels_from_results(dbscan_files: List[Path],
                               hdbscan_files: List[Path]) -> List[Tuple]:
    panels = []
    for f in dbscan_files:
        X, labels, _ = load_result_csv(f)
        eps = _extract_eps_from_filename(f)
        m = _label_stats(labels, 0.0)
        title = (f"[Spark] DBSCAN  eps={eps}  (~{int((eps or 0)*111_000)} m)\n"
                 f"clusters={m['clusters']}, noise={m['noise']:.1f}%")
        print(f"[load ] {f.name}  → clusters={m['clusters']}, noise={m['noise']:.1f}%")
        panels.append((title, X, labels))

    for f in hdbscan_files:
        X, labels, _ = load_result_csv(f)
        m = _label_stats(labels, 0.0)
        title = (f"[Spark] HDBSCAN\n"
                 f"clusters={m['clusters']}, noise={m['noise']:.1f}%")
        print(f"[load ] {f.name}  → clusters={m['clusters']}, noise={m['noise']:.1f}%")
        panels.append((title, X, labels))

    return panels


def build_panels_from_sklearn(X, eps_list, min_samples,
                               min_cluster_size) -> List[Tuple]:
    panels = []
    for eps in eps_list:
        labels, dt = _run_sklearn_dbscan(X, eps, min_samples)
        m = _label_stats(labels, dt)
        title = (f"[sklearn] DBSCAN  eps={eps}  (~{int(eps*111_000)} m)\n"
                 f"clusters={m['clusters']}, noise={m['noise']:.1f}%, {dt:.2f}s")
        print(f"[sklearn] DBSCAN eps={eps:<8} → clusters={m['clusters']}, "
              f"noise={m['noise']:.1f}%, {dt:.2f}s")
        panels.append((title, X, labels))

    labels, dt = _run_sklearn_hdbscan(X, min_cluster_size, min_samples)
    m = _label_stats(labels, dt)
    title = (f"[sklearn] HDBSCAN  min_cluster={min_cluster_size}\n"
             f"clusters={m['clusters']}, noise={m['noise']:.1f}%, {dt:.2f}s")
    print(f"[sklearn] HDBSCAN mc={min_cluster_size}  → clusters={m['clusters']}, "
          f"noise={m['noise']:.1f}%, {dt:.2f}s")
    panels.append((title, X, labels))
    return panels


# ---------- CLI ----------
def main():
    ap = argparse.ArgumentParser(
        description="Visualize Spark distributed-clustering results on NYC taxi data.",
        formatter_class=argparse.RawTextHelpFormatter)

    ap.add_argument("--data", type=Path, default=None,
                    help="Original CSV (x, y columns). Used to resolve result file prefix "
                         "and for sklearn fallback.")
    ap.add_argument("--mode", choices=["sweep", "map"], default="sweep")
    ap.add_argument("--out", type=Path, default=_PROJECT_ROOT / "data")

    # Explicit result files (override auto-discovery)
    ap.add_argument("--dbscan-files", type=Path, nargs="*", default=None,
                    help="Pre-computed DBSCAN result CSVs (from run_experiment.py).")
    ap.add_argument("--hdbscan-file", type=Path, nargs="*", default=None,
                    help="Pre-computed HDBSCAN result CSV(s).")

    # Auto-discovery directory
    ap.add_argument("--results-dir", type=Path, default=_PROJECT_ROOT / "data",
                    help="Directory to search for result CSVs (default: <project_root>/data/).")

    # Sklearn fallback params
    ap.add_argument("--fallback", action="store_true",
                    help="Force sklearn local run even if result files exist.")
    ap.add_argument("--eps-sweep", type=float, nargs="+",
                    default=[0.0002, 0.0005, 0.001, 0.002, 0.005],
                    help="eps values for sweep mode sklearn fallback.")
    ap.add_argument("--eps-map", type=float, nargs="+",
                    default=[0.0005, 0.001, 0.002],
                    help="eps values for map mode sklearn fallback.")
    ap.add_argument("--min-samples", type=int, default=10)
    ap.add_argument("--min-cluster-size", type=int, default=30)
    ap.add_argument("--zoom", type=int, default=11,
                    help="OSM zoom level for map mode (default: 11).")

    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Determine panels
    # ------------------------------------------------------------------
    use_spark_results = False

    if not args.fallback:
        # 1. Explicit files
        dbscan_files: List[Path] = list(args.dbscan_files or [])
        hdbscan_files: List[Path] = list(args.hdbscan_file or [])

        # 2. Auto-discovery
        if not dbscan_files and not hdbscan_files and args.data:
            dbscan_files, hdbscan_files = _discover_result_files(
                args.data, args.results_dir)
            if dbscan_files or hdbscan_files:
                print(f"[auto ] Found {len(dbscan_files)} DBSCAN + "
                      f"{len(hdbscan_files)} HDBSCAN result files.")

        if dbscan_files or hdbscan_files:
            # Validate existence
            for f in dbscan_files + hdbscan_files:
                if not f.exists():
                    raise SystemExit(f"[error] Result file not found: {f}")
            use_spark_results = True

    if use_spark_results:
        source_tag = "Spark distributed"
        panels = build_panels_from_results(dbscan_files, hdbscan_files)
        # Infer n_points from first file
        n_points = len(pd.read_csv(dbscan_files[0] if dbscan_files else hdbscan_files[0]))
        # For map mode we still need X (coordinates)
        # All result CSVs have x,y columns, so reuse them
        X_ref = pd.read_csv(dbscan_files[0] if dbscan_files else hdbscan_files[0])[["x","y"]].to_numpy()
    else:
        # sklearn fallback
        if args.data is None or not args.data.exists():
            raise SystemExit("[error] No result files found and --data not provided for sklearn fallback.")
        print(f"[info ] No Spark result files found (or --fallback set). "
              f"Running sklearn locally on {args.data}.")
        source_tag = "sklearn local"
        df = pd.read_csv(args.data)
        X_ref = df[["x", "y"]].to_numpy()
        n_points = len(X_ref)
        eps_list = args.eps_sweep if args.mode == "sweep" else args.eps_map
        panels = build_panels_from_sklearn(
            X_ref, eps_list, args.min_samples, args.min_cluster_size)

    if not panels:
        raise SystemExit("[error] No panels to render. Check your result files or --data.")

    if args.mode == "sweep":
        render_sweep(panels, args.out, n_points, source_tag)
    else:
        render_map(panels, args.out, n_points, source_tag, args.zoom)


if __name__ == "__main__":
    main()
