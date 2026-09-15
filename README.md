# TflBusMap
Displays all TFL bus routes on a map, using Mapbox GL and GeoJSON.

### Data
`bus_routes.json` was last scraped on 2026-09-15 from TFL's Open API:
* https://api.tfl.gov.uk/line/mode/bus/status
* https://api.tfl.gov.uk/line/1/route/sequence/inbound?formatter=json
* https://api.tfl.gov.uk/line/1/route/sequence/outbound?formatter=json
* ...

To refresh it, run `python scrape_routes.py` (stdlib only, no dependencies). It
draws the inbound direction of every route, falling back to outbound for the
routes that only run one way; `--both` draws both directions. The API works
anonymously but throttles hard, so a full run takes ~15 minutes — pass
`--app-key` (or set `$TFL_APP_KEY`) with a free key from
https://api-portal.tfl.gov.uk/ to speed that up. `--help` lists the rest.

### Live demo:
http://htmlpreview.github.io/?https://raw.githubusercontent.com/JakeCracknell/TflBusMap/master/index.html

### Preview
![Preview](preview.png?raw=true "Preview")
