#!/usr/bin/env python3
"""
P6 logo compositor — composite the REAL logo crop onto a generated clip so the brand mark is
pixel-exact instead of re-synthesized by the video model.

This satisfies the contract lib/video-generator/compositing.ts already invokes:

    <VIDEO_COMPOSITOR_CMD> --in <clip.mp4> --logo <logo.png> --bbox x,y,w,h --out <out.mp4>

where --bbox is the NORMALIZED (0..1) logo region in the clip's FIRST frame. Must write --out
and exit 0. Any non-zero exit (or missing output) makes the pipeline ship the ORIGINAL clip —
so failing loudly here is safe, and is strongly preferred over emitting a smeared overlay.

Wire it up with:
    VIDEO_COMPOSITE_LOGO=1
    VIDEO_FFMPEG_PATH=/usr/bin/ffmpeg
    VIDEO_COMPOSITOR_CMD="/usr/bin/python3 /abs/path/scripts/video-logo-compositor.py"

Requirements: python3, opencv-python (cv2), numpy, and ffmpeg on PATH (or --ffmpeg).
    pip install opencv-python numpy

Design notes
------------
* **Tracking.** The logo sits on fabric that moves, so a fixed overlay would slide off. We
  track the bbox with CSRT (falling back through the tracker APIs OpenCV has shuffled between
  versions), and refine each frame with normalized template matching, which is what keeps the
  box from drifting during slow garment motion.
* **Bail out rather than smear.** If tracking is lost on more than --max-lost-frac of frames,
  we exit non-zero so the pipeline ships the original. A visible artifact is worse than an
  imperfect AI logo — see risk #6 in the plan.
* **--mode still** is the conservative v1: overlay at the first-frame box for the whole clip,
  no tracking. Correct only for near-static shots (a brief asking for a slow push-in or a
  locked-off detail shot; not a runway walk).
* **Encoding.** Frames are piped to ffmpeg as rawvideo and encoded to H.264 + faststart, with
  the source's audio mapped through if present. cv2.VideoWriter's mp4v output is poorly
  compatible with browsers, so we don't use it.
* **--selftest** synthesizes a clip + logo and runs the whole path, so the install can be
  validated with no real assets. Run this first after installing OpenCV.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

try:
    import cv2
    import numpy as np
except ImportError as exc:  # keep the failure legible — this is invoked by a Node pipeline
    sys.stderr.write(
        f"missing dependency: {exc}. Install with: pip install opencv-python numpy\n"
    )
    sys.exit(3)


# --- tracker construction ----------------------------------------------------------------
# OpenCV has moved these between cv2, cv2.legacy and contrib across 4.x releases. Try the
# known spellings in preference order instead of pinning one version.
def make_tracker(kind: str = "csrt"):
    candidates = {
        "csrt": ["TrackerCSRT_create", "legacy.TrackerCSRT_create"],
        "kcf": ["TrackerKCF_create", "legacy.TrackerKCF_create"],
    }[kind]
    for path in candidates:
        obj = cv2
        try:
            for part in path.split("."):
                obj = getattr(obj, part)
            return obj()
        except AttributeError:
            continue
    return None


def clamp_rect(x, y, w, h, W, H):
    x = max(0, min(int(round(x)), W - 2))
    y = max(0, min(int(round(y)), H - 2))
    w = max(2, min(int(round(w)), W - x))
    h = max(2, min(int(round(h)), H - y))
    return x, y, w, h


def feathered_alpha(logo_bgra, w, h, feather):
    """Resize the logo to (w,h) and build a soft-edged alpha so the paste doesn't show a seam."""
    resized = cv2.resize(logo_bgra, (w, h), interpolation=cv2.INTER_AREA)
    if resized.shape[2] == 4:
        bgr = resized[:, :, :3].astype(np.float32)
        alpha = resized[:, :, 3].astype(np.float32) / 255.0
    else:
        bgr = resized.astype(np.float32)
        alpha = np.ones((h, w), dtype=np.float32)
    if feather > 0:
        mask = np.zeros((h, w), dtype=np.float32)
        pad = max(1, int(feather))
        mask[pad:-pad or None, pad:-pad or None] = 1.0
        k = pad * 2 + 1
        mask = cv2.GaussianBlur(mask, (k, k), 0)
        alpha = alpha * mask
    return bgr, alpha[:, :, None]


def refine_with_template(frame_gray, tmpl_gray, rect, search_pad):
    """Normalized cross-correlation inside a small window around `rect`. Returns (rect, score)."""
    H, W = frame_gray.shape[:2]
    x, y, w, h = rect
    x0 = max(0, x - search_pad)
    y0 = max(0, y - search_pad)
    x1 = min(W, x + w + search_pad)
    y1 = min(H, y + h + search_pad)
    window = frame_gray[y0:y1, x0:x1]
    if window.shape[0] < h or window.shape[1] < w:
        return rect, 0.0
    tmpl = cv2.resize(tmpl_gray, (w, h), interpolation=cv2.INTER_AREA)
    res = cv2.matchTemplate(window, tmpl, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(res)
    return (x0 + max_loc[0], y0 + max_loc[1], w, h), float(max_val)


def open_encoder(ffmpeg, out_path, width, height, fps, src_path, has_audio):
    args = [
        ffmpeg, "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-s", f"{width}x{height}", "-r", f"{fps}",
        "-i", "pipe:0",
    ]
    if has_audio:
        args += ["-i", src_path, "-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-shortest"]
    args += [
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        out_path,
    ]
    return subprocess.Popen(args, stdin=subprocess.PIPE, stderr=subprocess.PIPE)


def probe_has_audio(ffmpeg, path):
    ffprobe = os.path.join(os.path.dirname(ffmpeg), "ffprobe") if os.path.dirname(ffmpeg) else "ffprobe"
    if not (shutil.which(ffprobe) or os.path.exists(ffprobe)):
        return False
    try:
        out = subprocess.run(
            [ffprobe, "-loglevel", "error", "-select_streams", "a", "-show_entries",
             "stream=index", "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=30,
        )
        return bool(out.stdout.strip())
    except Exception:
        return False


def composite(args) -> int:
    ffmpeg = args.ffmpeg or shutil.which("ffmpeg") or os.environ.get("VIDEO_FFMPEG_PATH")
    if not ffmpeg:
        sys.stderr.write("ffmpeg not found (pass --ffmpeg or set VIDEO_FFMPEG_PATH)\n")
        return 3

    try:
        bx, by, bw, bh = [float(v) for v in args.bbox.split(",")]
    except ValueError:
        sys.stderr.write(f"--bbox must be 'x,y,w,h' normalized 0..1, got {args.bbox!r}\n")
        return 2
    if not (0 <= bx <= 1 and 0 <= by <= 1 and 0 < bw <= 1 and 0 < bh <= 1):
        sys.stderr.write(f"--bbox out of range: {args.bbox}\n")
        return 2

    logo = cv2.imread(args.logo, cv2.IMREAD_UNCHANGED)
    if logo is None:
        sys.stderr.write(f"could not read logo: {args.logo}\n")
        return 2
    if logo.ndim == 2:
        logo = cv2.cvtColor(logo, cv2.COLOR_GRAY2BGR)

    cap = cv2.VideoCapture(args.inp)
    if not cap.isOpened():
        sys.stderr.write(f"could not open clip: {args.inp}\n")
        return 2
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    if W < 2 or H < 2:
        sys.stderr.write("clip has no usable video stream\n")
        return 2

    ok, first = cap.read()
    if not ok:
        sys.stderr.write("could not read the first frame\n")
        return 2

    rect = clamp_rect(bx * W, by * H, bw * W, bh * H, W, H)
    # Template comes from the CLIP's first frame (what we're following), while the pixels we
    # paste come from the SOURCE logo crop (the ground truth).
    tmpl_gray = cv2.cvtColor(first[rect[1]:rect[1] + rect[3], rect[0]:rect[0] + rect[2]], cv2.COLOR_BGR2GRAY)

    tracker = None
    if args.mode == "track":
        tracker = make_tracker(args.tracker)
        if tracker is None:
            sys.stderr.write(
                f"no {args.tracker} tracker in this OpenCV build "
                "(install opencv-contrib-python, or use --mode still)\n"
            )
            return 3
        tracker.init(first, tuple(rect))

    has_audio = probe_has_audio(ffmpeg, args.inp) if not args.no_audio else False
    proc = open_encoder(ffmpeg, args.out, W, H, round(fps, 3), args.inp, has_audio)
    assert proc.stdin is not None

    stats = {"frames": 0, "tracked": 0, "lost": 0, "mode": args.mode, "fps": round(fps, 3),
             "size": [W, H], "audio": has_audio}
    frame = first
    last_good = rect
    try:
        while True:
            stats["frames"] += 1
            cur = rect
            if tracker is not None and stats["frames"] > 1:
                ok_t, box = tracker.update(frame)
                if ok_t:
                    cur = clamp_rect(box[0], box[1], box[2], box[3], W, H)
                    stats["tracked"] += 1
                else:
                    stats["lost"] += 1
                    cur = last_good
                if args.refine:
                    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    cand, score = refine_with_template(gray, tmpl_gray, cur, args.search_pad)
                    if score >= args.min_score:
                        cur = clamp_rect(*cand, W, H)
                    elif ok_t:
                        stats["lost"] += 1  # tracker claims a box the pixels don't support
            elif tracker is None:
                cur = rect  # still mode: fixed at the first-frame box

            last_good = cur
            x, y, w, h = cur
            bgr, alpha = feathered_alpha(logo, w, h, args.feather)
            roi = frame[y:y + h, x:x + w].astype(np.float32)
            frame[y:y + h, x:x + w] = (bgr * alpha + roi * (1.0 - alpha)).astype(np.uint8)

            proc.stdin.write(frame.tobytes())
            ok, nxt = cap.read()
            if not ok:
                break
            frame = nxt
    except BrokenPipeError:
        sys.stderr.write("ffmpeg closed the pipe early\n")
        return 4
    finally:
        cap.release()
        try:
            proc.stdin.close()
        except Exception:
            pass
        err = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
        rc = proc.wait()

    if rc != 0:
        sys.stderr.write(f"ffmpeg exited {rc}: {err[-400:]}\n")
        return 4
    if not os.path.exists(args.out) or os.path.getsize(args.out) == 0:
        sys.stderr.write("compositor produced no output\n")
        return 4

    # Bail out rather than ship a smeared overlay (the pipeline then delivers the original).
    considered = max(1, stats["frames"] - 1)
    lost_frac = stats["lost"] / considered if args.mode == "track" else 0.0
    stats["lost_frac"] = round(lost_frac, 3)
    stats["expected_frames"] = total
    if args.report:
        sys.stdout.write(json.dumps(stats) + "\n")
    if lost_frac > args.max_lost_frac:
        sys.stderr.write(
            f"tracking lost on {lost_frac:.0%} of frames (> --max-lost-frac "
            f"{args.max_lost_frac:.0%}); refusing to ship a drifting overlay\n"
        )
        try:
            os.remove(args.out)
        except OSError:
            pass
        return 5
    return 0


def selftest(args) -> int:
    """Synthesize a clip + logo, composite it, and assert the output is a readable video."""
    ffmpeg = args.ffmpeg or shutil.which("ffmpeg") or os.environ.get("VIDEO_FFMPEG_PATH")
    if not ffmpeg:
        sys.stderr.write("selftest needs ffmpeg (pass --ffmpeg or set VIDEO_FFMPEG_PATH)\n")
        return 3
    d = tempfile.mkdtemp(prefix="vg-comp-selftest-")
    clip, logo, out = os.path.join(d, "in.mp4"), os.path.join(d, "logo.png"), os.path.join(d, "out.mp4")
    W, H, N = 320, 240, 40
    print(f"[selftest] workdir {d}")

    # A moving grey square standing in for a logo on a garment.
    enc = open_encoder(ffmpeg, clip, W, H, 25, clip, False)
    assert enc.stdin is not None
    for i in range(N):
        f = np.full((H, W, 3), 40, np.uint8)
        x = 40 + i * 2
        cv2.rectangle(f, (x, 90), (x + 60, 130), (180, 180, 180), -1)
        enc.stdin.write(f.tobytes())
    enc.stdin.close()
    if enc.wait() != 0:
        sys.stderr.write("[selftest] could not synthesize the test clip\n")
        return 4

    cv2.imwrite(logo, np.dstack([
        np.full((40, 60), 0, np.uint8), np.full((40, 60), 0, np.uint8),
        np.full((40, 60), 255, np.uint8), np.full((40, 60), 255, np.uint8),
    ]))

    ns = argparse.Namespace(
        inp=clip, logo=logo, out=out, bbox=f"{40/W},{90/H},{60/W},{40/H}",
        ffmpeg=ffmpeg, mode="track", tracker="csrt", refine=True, feather=2,
        search_pad=24, min_score=0.35, max_lost_frac=0.5, no_audio=True, report=True,
    )
    rc = composite(ns)
    if rc != 0:
        sys.stderr.write(f"[selftest] composite returned {rc}\n")
        return rc
    cap = cv2.VideoCapture(out)
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    ok, f0 = cap.read()
    cap.release()
    if not ok:
        sys.stderr.write("[selftest] output is not readable\n")
        return 5
    # The overlay is pure red; assert it actually landed somewhere in frame 1.
    red = ((f0[:, :, 2] > 200) & (f0[:, :, 0] < 60) & (f0[:, :, 1] < 60)).sum()
    print(f"[selftest] output frames={frames} red_overlay_px={red}")
    if red < 100:
        sys.stderr.write("[selftest] overlay not visible in the output — compositing is broken\n")
        return 5
    print("[selftest] PASS")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Composite a real logo crop onto a generated clip.")
    p.add_argument("--in", dest="inp", help="input clip (mp4)")
    p.add_argument("--logo", help="logo crop (png, alpha honored)")
    p.add_argument("--out", help="output clip (mp4)")
    p.add_argument("--bbox", help="normalized x,y,w,h of the logo in the FIRST frame")
    p.add_argument("--ffmpeg", default=None, help="ffmpeg binary (default: PATH / VIDEO_FFMPEG_PATH)")
    p.add_argument("--mode", choices=["track", "still"], default="track",
                   help="track the logo (default) or pin it to the first-frame box")
    p.add_argument("--tracker", choices=["csrt", "kcf"], default="csrt")
    p.add_argument("--refine", action="store_true", default=True,
                   help="template-match refinement each frame (default on)")
    p.add_argument("--no-refine", dest="refine", action="store_false")
    p.add_argument("--feather", type=int, default=2, help="soft edge in px (0 = hard)")
    p.add_argument("--search-pad", type=int, default=24, help="refinement search window in px")
    p.add_argument("--min-score", type=float, default=0.35, help="min NCC score to accept a refinement")
    p.add_argument("--max-lost-frac", type=float, default=0.35,
                   help="fail (exit 5) if tracking is lost on more than this fraction of frames")
    p.add_argument("--no-audio", action="store_true", help="drop the source audio track")
    p.add_argument("--report", action="store_true", help="print JSON stats to stdout")
    p.add_argument("--selftest", action="store_true", help="synthesize a clip and validate the install")
    args = p.parse_args()

    if args.selftest:
        return selftest(args)
    missing = [f for f in ("inp", "logo", "out", "bbox") if not getattr(args, f)]
    if missing:
        p.error("missing required: " + ", ".join("--in" if m == "inp" else f"--{m}" for m in missing))
    return composite(args)


if __name__ == "__main__":
    sys.exit(main())
