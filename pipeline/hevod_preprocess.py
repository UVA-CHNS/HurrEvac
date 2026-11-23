"""
HEvOD static site export. Run after rawData_processing.ipynb.

Reads   data/temp/hurricane_processed.parquet, data/temp/PAD_processed.parquet, geojson-counties-fips.json,
        data/<workbook>.xlsx
Writes  ../docs/data/   events.json, events/<event>.json, counties_subset.json, geo_meta.json,
                        <workbook>.xlsx, workbooks/<event>.xlsx (README sheet + one hurricane sheet each)

Usage (from this folder):
    python hevod_preprocess.py
"""
import argparse
import bisect
import html
import json
import math
import re
import shutil
import textwrap
from pathlib import Path

import pandas as pd

import config

Z_BY_CODE = {0: 1, 2: 2, 1: 3, 3: 4}       # stacking rank at equal announcement time (higher wins)
GEO_SIMPLIFY_TOL = 0.003                   # degrees (~300 m); 0 disables
GEO_DECIMALS = 4

STATE_ABBR = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
    "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
    "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
    "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
    "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
    "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "72": "PR", "78": "VI",
}


def to_epoch_ms(series):
    s = pd.to_datetime(series)
    if s.dt.tz is None:
        s = s.dt.tz_localize("UTC")
    s = s.dt.tz_convert("UTC").dt.tz_localize(None)
    return ((s - pd.Timestamp("1970-01-01")) // pd.Timedelta("1ms")).astype("int64")


def fmt_effective(date_val, time_val):
    if pd.isna(date_val):
        return ""
    d = pd.Timestamp(date_val)
    hh = mm = 0
    if time_val is not None and not (isinstance(time_val, float) and math.isnan(time_val)):
        parts = str(time_val).strip().split(":")
        try:
            hh, mm = int(parts[0]), int(parts[1])
        except (ValueError, IndexError):
            hh = mm = 0
    return "{:02d}/{:02d}/{} {}:{:02d} {}".format(d.month, d.day, d.year, hh % 12 or 12, mm, "AM" if hh < 12 else "PM")


def fmt_area(text, width=70, max_lines=6):
    if text is None or (isinstance(text, float) and math.isnan(text)):
        return ""
    t = " ".join(str(text).split())
    if not t or t.lower() in ("not available", "na", "n/a", "nan"):
        return ""
    lines = textwrap.wrap(html.escape(t, quote=False), width=width)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip(" .,;") + " ..."
    return "<br>".join(lines)


def slug(name):
    return re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_")


def rdp(points, eps):
    n = len(points)
    if n <= 4 or eps <= 0:
        return points
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        dmax, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            d = math.hypot(px - ax, py - ay) if norm == 0 else abs(dy * (px - ax) - dx * (py - ay)) / norm
            if d > dmax:
                dmax, idx = d, i
        if dmax > eps:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(points, keep) if k]


def simplify_ring(ring):
    pts = [(round(x, GEO_DECIMALS), round(y, GEO_DECIMALS)) for x, y in ring]
    dedup = [pts[0]]
    for p in pts[1:]:
        if p != dedup[-1]:
            dedup.append(p)
    if len(dedup) < 4:
        return [list(p) for p in pts]
    mid = len(dedup) // 2
    out = rdp(dedup[:mid + 1], GEO_SIMPLIFY_TOL)[:-1] + rdp(dedup[mid:], GEO_SIMPLIFY_TOL)
    if len(out) < 4:
        out = dedup
    return [list(p) for p in out]


def simplify_geometry(geom):
    if geom["type"] == "Polygon":
        return {"type": "Polygon", "coordinates": [simplify_ring(r) for r in geom["coordinates"]]}
    if geom["type"] == "MultiPolygon":
        return {"type": "MultiPolygon", "coordinates": [[simplify_ring(r) for r in poly] for poly in geom["coordinates"]]}
    return geom


def geometry_bbox(geom):
    xs, ys = [], []
    for poly in [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]:
        for x, y in poly[0]:
            xs.append(x)
            ys.append(y)
    return [min(xs), min(ys), max(xs), max(ys)]


def load_hurricane(path):
    df = pd.read_parquet(path)
    df["Order Type"] = df["Order Type"].astype(str).str.strip()
    df["FIPS"] = pd.Series(
        [str(x).strip().zfill(5) if pd.notna(x) and str(x).strip() not in ("", "<NA>", "nan") else None
         for x in df["FIPS"]], index=df.index, dtype=object)
    df["Announce_ms"] = to_epoch_ms(df["Order Announcement Time UTC"])
    df["Z"] = df["Order Type Code"].map(Z_BY_CODE).fillna(1).astype("int8")
    df["Is Statewide"] = df["FIPS"].isna()
    df["Effective Text"] = [fmt_effective(d, t) for d, t in zip(df["Effective Date"], df["Effective Time"])]
    df["Area Text"] = df["Evacuation Area"].map(fmt_area)
    return df.sort_values(["Event Name", "Announce_ms", "Z"], kind="stable").reset_index(drop=True)


def load_pad(path):
    pad = pd.read_parquet(path)
    pad["PAD_ms"] = to_epoch_ms(pad["Public Advisories Time UTC"])
    return pad.drop_duplicates(["Event Name", "PAD_ms"]).sort_values(["Event Name", "PAD_ms"]).reset_index(drop=True)


def check_order_types(df):
    known = {s["name"] for s in config.ORDER_TYPE_STYLES}
    bad = sorted(set(df["Order Type"]) - known)
    for name, n in df["Order Type"].value_counts().items():
        print("  {:6d}  {}{}".format(n, name, "" if name in known else "   <-- not in config.ORDER_TYPE_STYLES"))
    if bad:
        raise SystemExit("Fix these Order Type names (or config.ORDER_TYPE_STYLES) and re-run: {}".format(bad))


def export_geo(df, geojson_path, out_dir):
    with open(geojson_path, encoding="utf-8") as fh:
        feats = json.load(fh)["features"]
    statewide = set(df.loc[df["Is Statewide"], "States_FIPS"].dropna().astype(int).map("{:02d}".format))
    county_ids = set(df["FIPS"].dropna())
    missing = sorted(county_ids - {f["id"] for f in feats})
    if missing:
        print("  WARNING: {} county FIPS not in the GeoJSON (not drawn): {}".format(len(missing), missing[:25]))
    out_feats, names, bbox, state_counties = [], {}, {}, {}
    for f in feats:
        p, fid = f["properties"], f["id"]
        if fid not in county_ids and p["STATE"] not in statewide:
            continue
        nm = (p["NAME"] + " " + (p.get("LSAD") or "")).strip()
        geom = simplify_geometry(f["geometry"]) if GEO_SIMPLIFY_TOL > 0 else f["geometry"]
        names[fid] = nm
        bbox[fid] = [round(v, 3) for v in geometry_bbox(geom)]
        state_counties.setdefault(p["STATE"], []).append(fid)
        out_feats.append({"type": "Feature", "id": fid, "properties": {"n": nm}, "geometry": geom})
    abbr = dict(STATE_ABBR)
    for s, c in df[["States", "States_FIPS"]].dropna().drop_duplicates().itertuples(index=False):
        abbr["{:02d}".format(int(c))] = str(s).strip()
    dump = lambda obj, name: (out_dir / name).write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")
    dump({"type": "FeatureCollection", "features": out_feats}, "counties_subset.json")
    meta = {"state_counties": state_counties, "names": names, "state_abbr": abbr, "bbox": bbox}
    dump(meta, "geo_meta.json")
    print("  counties kept: {} of {}".format(len(out_feats), len(feats)))
    return meta


def build_ticks(order_ms, pad_ms):
    order_ms, pad_ms = sorted(order_ms), sorted(pad_ms)
    if not pad_ms:
        return [{"t": int(t), "kind": "pad"} for t in sorted(set(order_ms))]
    first_o, last_o = order_ms[0], order_ms[-1]
    i0 = max(bisect.bisect_left(pad_ms, first_o) - 1, 0)
    i1 = min(bisect.bisect_left(pad_ms, last_o), len(pad_ms) - 1)
    ticks = []
    pre = [t for t in order_ms if t < pad_ms[0]]
    if pre:
        ticks.append({"t": int(pre[-1]), "kind": "pre"})
    ticks += [{"t": int(t), "kind": "pad"} for t in pad_ms[i0:i1 + 1]]
    if last_o > pad_ms[-1]:
        ticks.append({"t": int(last_o), "kind": "post"})
    return ticks


def event_bbox(records, meta):
    boxes = []
    for r in records:
        if r["f"]:
            b = meta["bbox"].get(r["f"])
            if b:
                boxes.append(b)
        else:
            boxes += [meta["bbox"][f] for f in meta["state_counties"].get(r["s"], [])]
    if not boxes:
        return None
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def event_payload(d, pad_ms, meta, type_index):
    records = []
    for t, f, sf, ty, cn, ab, area, eff in zip(
            d["Announce_ms"], d["FIPS"], d["States_FIPS"], d["Order Type"], d["Counties Short"], d["States"],
            d["Area Text"], d["Effective Text"]):
        rec = {"t": int(t), "f": f if isinstance(f, str) else None, "s": "{:02d}".format(int(sf)),
               "ty": type_index[ty], "cn": cn if isinstance(cn, str) else "", "ab": ab if isinstance(ab, str) else ""}
        if area:
            rec["a"] = area
        if eff:
            rec["e"] = eff
        records.append(rec)
    return {"event": d["Event Name"].iloc[0], "records": records,
            "ticks": build_ticks(d["Announce_ms"].tolist(), pad_ms), "bbox": event_bbox(records, meta)}


def sheet_name_for(event_name, year):
    return "{} {}".format(year, re.sub(r"^\s*Hurricane\s+|\s*\(\d{4}\)\s*$", "", event_name))


def export_workbooks(events, xlsx_path, out_dir):
    import openpyxl
    norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
    shutil.copyfile(xlsx_path, out_dir / config.WORKBOOK_NAME)
    (out_dir / "workbooks").mkdir(exist_ok=True)
    missing = []
    for ev in events:
        wb = openpyxl.load_workbook(xlsx_path)
        want = norm(sheet_name_for(ev["name"], ev["year"]))
        keep = [ws.title for ws in wb.worksheets if norm(ws.title) in ("readme", want)]
        if not any(norm(t) == want for t in keep):
            missing.append(ev["name"])
            continue
        for ws in list(wb.worksheets):
            if ws.title not in keep:
                wb.remove(ws)
        wb.save(out_dir / "workbooks" / (ev["file"].replace(".json", ".xlsx")))
    if missing:
        print("  WARNING: no workbook sheet found for:", missing)
    return missing


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", default="data/temp")
    ap.add_argument("--geojson", default="geojson-counties-fips.json")
    ap.add_argument("--workbook", default="data/" + config.WORKBOOK_NAME)
    ap.add_argument("--out", default="../docs/data")
    ap.add_argument("--skip-workbooks", action="store_true", help="do not rebuild the per-hurricane workbooks")
    args = ap.parse_args()
    data_dir, out = Path(args.data_dir), Path(args.out)
    (out / "events").mkdir(parents=True, exist_ok=True)

    print("[1/4] reading parquet files")
    hur = load_hurricane(data_dir / "hurricane_processed.parquet")
    pad = load_pad(data_dir / "PAD_processed.parquet")
    print("  rows: {} | events: {} | advisory rows: {}".format(len(hur), hur["Event Name"].nunique(), len(pad)))
    no_pad = sorted(set(hur["Event Name"]) - set(pad["Event Name"]))
    if no_pad:
        print("  WARNING: events without advisory data:", no_pad)
    check_order_types(hur)

    print("[2/4] county geometry")
    meta = export_geo(hur, args.geojson, out)

    print("[3/4] events")
    styles = config.ORDER_TYPE_STYLES
    type_index = {s["name"]: i for i, s in enumerate(styles)}
    trace_of, n = [], 1
    for s in styles:
        if s["mode"] == "fill":
            trace_of.append(0)
        else:
            trace_of.append(n)
            n += 1
    for old in (out / "events").glob("*.json"):
        old.unlink()
    events = []
    for name, d in hur.groupby("Event Name", sort=False):
        payload = event_payload(d, pad.loc[pad["Event Name"] == name, "PAD_ms"].tolist(), meta, type_index)
        fname = slug(name) + ".json"
        (out / "events" / fname).write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        events.append({"name": name, "year": int(d["Year"].iloc[0]), "file": fname, "first": int(d["Announce_ms"].min())})
    events.sort(key=lambda e: e["first"], reverse=True)
    index = {
        "styles": styles, "traceOf": trace_of, "nTraces": n, "outlineWidth": config.OUTLINE_WIDTH,
        "basemaps": config.BASEMAP_STYLES, "nhcOverrides": config.NHC_LINK_OVERRIDES,
        "timezones": [{"value": v, "label": l} for v, l in config.TIMEZONES],
        "workbook": config.WORKBOOK_NAME, "events": events,
    }
    (out / "events.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")

    print("[4/4] workbooks")
    if args.skip_workbooks:
        print("  skipped")
    else:
        for old in (out / "workbooks").glob("*.xlsx"):
            old.unlink()
        export_workbooks(events, Path(args.workbook), out)
    print("Done. Files written to", out.resolve())


if __name__ == "__main__":
    main()
