#!/usr/bin/env python3
"""Rescrape all TFL bus routes from the Unified API into bus_routes.json.

Hits the same endpoints the original 2018 scrape used:
  https://api.tfl.gov.uk/line/mode/bus/status            -> the list of bus lines
  https://api.tfl.gov.uk/line/<id>/route/sequence/<dir>  -> the route geometry

Each route sequence returns `lineStrings`: JSON-encoded arrays of [lon, lat]
pairs, which become one GeoJSON LineString feature each.

Usage:
  python scrape_routes.py                    # inbound routes -> bus_routes.json
  python scrape_routes.py --both             # both directions
  python scrape_routes.py --app-key YOURKEY  # raises the API rate limit

The API works without a key (~50 requests/minute); a free key from
https://api-portal.tfl.gov.uk/ lifts that to 500/minute. Either way there are
~700 lines to fetch, so expect the run to take a couple of minutes.

Stdlib only, Python 3.7+.
"""

import argparse
import json
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API_ROOT = "https://api.tfl.gov.uk"
# The API 403s the default urllib user agent.
USER_AGENT = "TflBusMap/1.0 (+https://github.com/JakeCracknell/TflBusMap)"
DEFAULT_OUTPUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bus_routes.json")

# simplestyle properties, carried over from the original scrape
STROKE = "#FF0000"
STROKE_WIDTH = 2
STROKE_OPACITY = 1

# TFL's documented caps: ~50 requests/minute anonymously, 500 with an app key.
ANONYMOUS_RATE = 50
KEYED_RATE = 500

print_lock = threading.Lock()


def log(message):
    with print_lock:
        print(message, file=sys.stderr, flush=True)


class RateLimiter:
    """Hands out evenly spaced request slots to keep us under TFL's cap.

    Going over it just means 429s and retries, which is slower than waiting
    politely, so the limiter is what actually makes a full run finish.
    """

    def __init__(self, per_minute):
        self.interval = 60.0 / per_minute if per_minute > 0 else 0.0
        self.lock = threading.Lock()
        self.next_slot = 0.0

    def wait(self):
        if not self.interval:
            return
        with self.lock:
            slot = max(time.monotonic(), self.next_slot)
            self.next_slot = slot + self.interval
        delay = slot - time.monotonic()
        if delay > 0:
            time.sleep(delay)

    def back_off(self, seconds):
        """Hold every worker back, not just the one that got the 429."""
        with self.lock:
            self.next_slot = max(self.next_slot, time.monotonic() + seconds)


def get_json(path, app_key=None, limiter=None, attempts=8):
    """GET a JSON document, retrying on rate limits and transient failures."""
    url = API_ROOT + path
    if app_key:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode({"app_key": app_key})

    for attempt in range(1, attempts + 1):
        try:
            if limiter:
                limiter.wait()
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            # 429 = rate limited, 5xx = TFL having a moment. Anything else is ours.
            if error.code != 429 and error.code < 500:
                raise
            retry_after = error.headers.get("Retry-After") if error.headers else None
            delay = float(retry_after) if retry_after and retry_after.isdigit() else 2 ** attempt
            reason = "rate limited" if error.code == 429 else "HTTP %d" % error.code
            if error.code == 429 and limiter:
                limiter.back_off(delay)
        except (urllib.error.URLError, OSError, ValueError) as error:
            delay = 2 ** attempt
            reason = type(error).__name__

        if attempt == attempts:
            raise RuntimeError("%s failed after %d attempts (%s)" % (path, attempts, reason))
        time.sleep(delay + random.uniform(0, 1))


def list_bus_lines(app_key, limiter):
    """Return (id, name) per bus line.

    The API takes lowercase ids in URLs ('n1') but its display name is the
    uppercase form ('N1'), which is what init_map.js matches on to spot night
    buses, so keep both.
    """
    lines = get_json("/line/mode/bus/status", app_key, limiter)
    return [(line["id"], line.get("name") or line["id"].upper()) for line in lines]


def coordinate_lists(line_strings):
    """Flatten the `lineStrings` field into plain lists of [lon, lat] pairs.

    Each entry is a JSON string holding either a list of coordinate pairs or a
    list of such lists, so unwrap one level when we find one.
    """
    for encoded in line_strings:
        decoded = json.loads(encoded) if isinstance(encoded, str) else encoded
        if not decoded:
            continue
        nested = isinstance(decoded[0], (list, tuple)) and isinstance(decoded[0][0], (list, tuple))
        for coordinates in (decoded if nested else [decoded]):
            if len(coordinates) >= 2:
                yield coordinates


def fetch_route(line, direction, app_key, limiter):
    """Return the GeoJSON features for one line in one direction."""
    line_id, line_name = line
    path = "/line/%s/route/sequence/%s?formatter=json" % (urllib.parse.quote(line_id), direction)
    sequence = get_json(path, app_key, limiter)
    return [
        {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coordinates},
            "properties": {
                "line": line_name,
                "direction": direction,
                "stroke": STROKE,
                "stroke-width": STROKE_WIDTH,
                "stroke-opacity": STROKE_OPACITY,
            },
        }
        for coordinates in coordinate_lists(sequence.get("lineStrings") or [])
    ]


def fetch_line(line, directions, fallback, app_key, limiter):
    """Fetch every requested direction for a line, falling back if asked to."""
    features = []
    for direction in directions:
        features.extend(fetch_route(line, direction, app_key, limiter))
    if not features and fallback:
        # Outbound-only routes (and the odd inbound-only one) have no geometry
        # in the requested direction, so take whatever the other one gives.
        for direction in ("outbound", "inbound"):
            if direction in directions:
                continue
            found = fetch_route(line, direction, app_key, limiter)
            if found:
                return found
    return features


def natural_key(line_id):
    """Sort '2' before '10' before 'N2', so the output diffs sensibly."""
    digits = "".join(c for c in line_id if c.isdigit())
    prefix = "".join(c for c in line_id if not c.isdigit())
    return (prefix.upper(), int(digits) if digits else 0, line_id)


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", default=DEFAULT_OUTPUT,
                        help="GeoJSON file to write (default: bus_routes.json)")
    parser.add_argument("--direction", choices=("inbound", "outbound"), default="inbound",
                        help="which direction of each route to draw (default: inbound)")
    parser.add_argument("--both", action="store_true",
                        help="draw both directions of every route")
    parser.add_argument("--app-key", default=os.environ.get("TFL_APP_KEY"),
                        help="TFL API key (default: $TFL_APP_KEY); raises the rate limit")
    parser.add_argument("--workers", type=int, default=8,
                        help="concurrent requests (default: 8)")
    parser.add_argument("--rate", type=int,
                        help="requests per minute (default: %d, or %d with an app key; 0 = unlimited)"
                             % (ANONYMOUS_RATE, KEYED_RATE))
    parser.add_argument("--allow-failures", type=int, default=0,
                        help="write the output even if this many lines fail (default: 0)")
    parser.add_argument("--limit", type=int, help="only scrape the first N lines, for a quick test")
    args = parser.parse_args()

    directions = ("inbound", "outbound") if args.both else (args.direction,)
    rate = args.rate if args.rate is not None else (KEYED_RATE if args.app_key else ANONYMOUS_RATE)
    limiter = RateLimiter(rate)

    log("Fetching bus line list...")
    lines = list_bus_lines(args.app_key, limiter)
    if args.limit:
        lines = lines[:args.limit]
    log("Fetching %s routes for %d lines with %d workers at %s..."
        % (" and ".join(directions), len(lines), args.workers,
           "%d requests/min" % rate if rate else "full speed"))
    if rate:
        log("Expect roughly %d minutes." % max(1, round(len(lines) * len(directions) / rate)))

    features_by_line = {}
    failures = {}
    progress = [0]

    def scrape(line):
        try:
            features_by_line[line[1]] = fetch_line(
                line, directions, not args.both, args.app_key, limiter)
        except Exception as error:  # reported in the summary below
            failures[line[1]] = error
        with print_lock:
            progress[0] += 1
            if progress[0] % 50 == 0 or progress[0] == len(lines):
                print("  %d/%d lines" % (progress[0], len(lines)), file=sys.stderr, flush=True)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(scrape, lines))

    for line_id, error in sorted(failures.items()):
        log("FAILED %s: %s" % (line_id, error))
    empty = sorted((l for l, f in features_by_line.items() if not f), key=natural_key)
    if empty:
        log("No geometry returned for %d lines: %s" % (len(empty), ", ".join(empty)))
    if len(failures) > args.allow_failures:
        log("Aborting without writing %s (%d failures, --allow-failures is %d)"
            % (args.output, len(failures), args.allow_failures))
        return 1

    features = [f for line_id in sorted(features_by_line, key=natural_key)
                for f in features_by_line[line_id]]
    if not features:
        log("Aborting: no features scraped at all")
        return 1

    # Write via a temp file so an interrupted run can't leave a truncated map.
    temporary = args.output + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump({"type": "FeatureCollection", "features": features}, handle)
    os.replace(temporary, args.output)

    log("Wrote %d features from %d lines to %s (%.1f MB)"
        % (len(features), len(features_by_line) - len(empty), args.output,
           os.path.getsize(args.output) / 1e6))
    log("Remember to update the scrape date in README.md: %s" % time.strftime("%Y-%m-%d"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
