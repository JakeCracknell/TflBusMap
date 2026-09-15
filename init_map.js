const HIGHLIGHT_BBOX_SIZE = 20;
const BADGE_VIEWPORT_PADDING = 30;
const BADGE_FONT = "bold 13px Arial, Helvetica, sans-serif";
const HIGHLIGHT_LINE_WIDTH = 4;
const HIGHLIGHT_CASING_WIDTH = 6;
const HIGHLIGHT_MIN_LINE_WIDTH = 1.5;
const HIGHLIGHT_LANE_SPACING = 7;
const HIGHLIGHT_MAX_SPREAD = 42;
const CORRIDOR_TOLERANCE_DEGREES = 25;
// One colour per highlighted route. Distinct at a glance, and all dark enough
// to carry white badge text.
const ROUTE_COLOURS = [
    "#DC241F", // TfL red
    "#0077C8", // blue
    "#007D32", // green
    "#8A2BE2", // violet
    "#C2571A", // orange
    "#0F7F8F", // teal
    "#B3005E", // magenta
    "#8C6D1F"  // olive
];
const SelectionModeEnum = Object.freeze({
    NONE_SELECTED: "NONE_SELECTED",
    BBOX_SELECTED: "BBOX_SELECTED",
    LINE_SELECTED: "LINE_SELECTED"
});

mapboxgl.accessToken = 'pk.eyJ1IjoiemV0dGVyIiwiYSI6ImVvQ3FGVlEifQ.jGp_PWb6xineYqezpSd7wA';

let allGeojson;
let highlightedGeojson = {"type": "FeatureCollection", "features": []};
let badgeGeojson = {"type": "FeatureCollection", "features": []};
const badgeImages = new Set();
let selectionMode = SelectionModeEnum.NONE_SELECTED;


var map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v10',
    center: [-0.142, 51.506],
    zoom: 10
});

map.on('load', () => $.getJSON('bus_routes.json', onGeojsonLoaded));

function hoverOverPoint(point) {
    let featuresAroundPoint;
    if (selectionMode === SelectionModeEnum.NONE_SELECTED) {
        featuresAroundPoint = getFeaturesAroundPoint(point, 'bus_routes');
        highlightedGeojson.features =
            styleHighlightedRoutes(featuresAroundPoint, map.unproject(point).toArray());
        map.getSource("bus_routes_highlighted").setData(highlightedGeojson);
        updateBadges();
    } else if (selectionMode === SelectionModeEnum.BBOX_SELECTED) {
        featuresAroundPoint = getFeaturesAroundPoint(point, 'bus_routes_highlighted')
    }
    if (featuresAroundPoint.length > 0) {
        map.getCanvas().style.cursor = 'pointer';
    } else {
        map.getCanvas().style.cursor = '';
    }
}

function onMapClick(e) {
    if (selectionMode === SelectionModeEnum.NONE_SELECTED && getFeaturesAroundPoint(e.point, 'bus_routes').length > 0) {
        selectionMode = SelectionModeEnum.BBOX_SELECTED;
    } else if (selectionMode === SelectionModeEnum.BBOX_SELECTED) {
        const ids = new Set(getFeaturesAroundPoint(e.point, 'bus_routes_highlighted').map(f => f.id));
        const selectedLine = nearestRenderedRoute(highlightedGeojson.features.filter(f => ids.has(f.id)), e.point);
        if (selectedLine) {
            //selectionMode = SelectionModeEnum.LINE_SELECTED;
            const url = "https://tfl.gov.uk/bus/route/" + selectedLine.properties.line +
                "/?direction=" + selectedLine.properties.direction;
            new mapboxgl.Popup({closeOnClick: true})
                .setLngLat(map.unproject(e.point))
                .setHTML(`<a href="${url}" target="_blank">${selectedLine.properties.line} bus on TFL</h1>`)
                .addTo(map);
        } else {
            selectionMode = SelectionModeEnum.NONE_SELECTED;
        }
    }
}

function getFeaturesAroundPoint(point, layer) {
    const bbox = [[point.x - HIGHLIGHT_BBOX_SIZE, point.y - HIGHLIGHT_BBOX_SIZE],
        [point.x + HIGHLIGHT_BBOX_SIZE, point.y + HIGHLIGHT_BBOX_SIZE]];
    // queryRenderedFeatures returns tile-clipped fragments of a route, so look the
    // whole feature back up in the source data by id instead of using the fragment.
    const seenIds = new Set();
    const features = [];
    for (const fragment of map.queryRenderedFeatures(bbox, {layers: [layer]})) {
        if (seenIds.has(fragment.id)) {
            continue;
        }
        seenIds.add(fragment.id);
        const feature = allGeojson.features[fragment.id] || fragment;
        if (!feature.properties.line.startsWith("N")) {
            features.push(feature);
        }
    }
    return features;
}

// Now that the routes are fanned out into lanes, the one the query happens to
// return first is not the one being pointed at. Mapbox queries the route's real
// geometry rather than the offset line it drew, so re-apply the offset here and
// pick whichever route was actually drawn nearest the click.
function nearestRenderedRoute(features, point) {
    // Projecting every point of every route would be tens of thousands of
    // projections per click, so throw away everything outside the click area
    // first - in longitude and latitude, which needs no projection at all.
    const pad = HIGHLIGHT_BBOX_SIZE + HIGHLIGHT_MAX_SPREAD;
    const corners = [[-pad, -pad], [pad, -pad], [pad, pad], [-pad, pad]]
        .map(c => map.unproject([point.x + c[0], point.y + c[1]]));
    const minLng = Math.min(...corners.map(c => c.lng));
    const maxLng = Math.max(...corners.map(c => c.lng));
    const minLat = Math.min(...corners.map(c => c.lat));
    const maxLat = Math.max(...corners.map(c => c.lat));
    let nearest = null;
    let nearestDistance = Infinity;
    for (const feature of features) {
        const offset = feature.properties.offset || 0;
        const coordinates = feature.geometry.coordinates;
        for (let i = 0; i < coordinates.length; i++) {
            const coordinate = coordinates[i];
            if (coordinate[0] < minLng || coordinate[0] > maxLng ||
                coordinate[1] < minLat || coordinate[1] > maxLat) {
                continue;
            }
            const here = map.project(coordinate);
            // The segments either side of the vertex, so that the very ends of a
            // route are offset the same way as the rest of it.
            const before = map.project(coordinates[Math.max(0, i - 1)]);
            const after = map.project(coordinates[Math.min(coordinates.length - 1, i + 1)]);
            const dx = after.x - before.x;
            const dy = after.y - before.y;
            const length = Math.hypot(dx, dy) || 1;
            // A positive offset is drawn to the right of the way the line runs,
            // which on screen - y pointing down - is (-dy, dx).
            const distance = Math.hypot(here.x - offset * dy / length - point.x,
                here.y + offset * dx / length - point.y);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = feature;
            }
        }
    }
    return nearest;
}

function onGeojsonLoaded(data) {
    allGeojson = data;
    allGeojson.features.forEach((feature, i) => feature.id = i);
    map.addSource('bus_routes', {
        type: 'geojson',
        data: allGeojson
    });
    map.addSource('bus_routes_highlighted', {
        type: 'geojson',
        data: highlightedGeojson
    });
    map.addSource('bus_route_badges', {
        type: 'geojson',
        data: badgeGeojson
    });
    map.addLayer({
        id: 'bus_routes',
        type: 'line',
        source: 'bus_routes',
        paint: {
            //"line-opacity": 0.1
            "line-width": 1
        }
    });
    // A white casing under every highlighted route keeps neighbouring routes
    // legible where they run alongside each other.
    map.addLayer({
        id: 'bus_routes_highlighted_casing',
        type: 'line',
        source: 'bus_routes_highlighted',
        layout: {
            "line-cap": "round",
            "line-join": "round"
        },
        paint: {
            "line-color": "#FFFFFF",
            "line-width": ["get", "casing"],
            "line-offset": ["get", "offset"]
        }
    });
    map.addLayer({
        id: 'bus_routes_highlighted',
        type: 'line',
        source: 'bus_routes_highlighted',
        layout: {
            "line-cap": "round",
            "line-join": "round"
        },
        paint: {
            "line-color": ["to-color", ["get", "colour"]],
            "line-width": ["get", "width"],
            "line-offset": ["get", "offset"]
        }
    });
    map.addLayer({
        id: 'bus_route_badges',
        type: 'symbol',
        source: 'bus_route_badges',
        layout: {
            "icon-image": "badge-{line}-{colourIndex}",
            "icon-anchor": "bottom",
            "icon-offset": [0, -2],
            "icon-padding": 1
        }
    });
    // the highlight is frozen while a bbox is selected, so keep the badges on
    // screen as the map moves underneath them.
    map.on('moveend', updateBadges);
    map.on('mousemove', e => hoverOverPoint(e.point));
    map.on('touchmove', () => hoverOverPoint({x: window.innerWidth / 2, y: window.innerHeight / 2}));
    map.on('click', onMapClick);
}

// Gives every highlighted route its own colour, and its own lane: routes are
// drawn parallel to one another rather than stacked, so three routes sharing a
// street show up as three lines instead of whichever one is drawn last.
// Returns copies of the features - the originals are shared with the base layer.
function styleHighlightedRoutes(features, anchor) {
    const byLine = new Map();
    for (const feature of features) {
        const line = feature.properties.line;
        if (!byLine.has(line)) {
            byLine.set(line, {line: line, features: []}); // both directions of a route share a lane
        }
        byLine.get(line).features.push(feature);
    }
    const routes = Array.from(byLine.values());
    for (const route of routes) {
        route.direction = localDirection(route.features[0].geometry.coordinates, anchor);
        route.bearing = (Math.atan2(route.direction[0], route.direction[1]) * 180 / Math.PI % 180 + 180) % 180;
    }
    const styled = [];
    let colourIndex = 0;
    for (const corridor of groupIntoCorridors(routes)) {
        // Sorted by route number, so that a given set of routes always gets the
        // same lanes and colours rather than reshuffling on every mouse move.
        corridor.sort((a, b) => a.line.localeCompare(b.line, undefined, {numeric: true}));
        const spacing = Math.min(HIGHLIGHT_LANE_SPACING, HIGHLIGHT_MAX_SPREAD / Math.max(1, corridor.length - 1));
        // A busy corridor is only allowed to fan out so far, so past about seven
        // routes the lines thin down to keep fitting in their lanes instead of
        // going back to covering each other up.
        const width = Math.min(HIGHLIGHT_LINE_WIDTH, Math.max(HIGHLIGHT_MIN_LINE_WIDTH, spacing - 1));
        const casing = Math.min(HIGHLIGHT_CASING_WIDTH, Math.max(width + 1, spacing));
        const reference = corridor[0].direction;
        corridor.forEach((route, i) => {
            const lane = (i - (corridor.length - 1) / 2) * spacing;
            // Running the colours on across corridors keeps them consecutive -
            // and so distinct - among the routes actually drawn side by side.
            const colour = colourIndex % ROUTE_COLOURS.length;
            colourIndex++;
            for (const feature of route.features) {
                const direction = localDirection(feature.geometry.coordinates, anchor);
                // line-offset is measured to the right of the direction the line
                // is drawn in, so a route digitised the other way round would fan
                // out on the wrong side. Flip it to keep the lanes in order.
                const sign = direction[0] * reference[0] + direction[1] * reference[1] < 0 ? -1 : 1;
                styled.push({
                    type: "Feature",
                    id: feature.id,
                    geometry: feature.geometry,
                    properties: Object.assign({}, feature.properties, {
                        colour: ROUTE_COLOURS[colour],
                        colourIndex: colour,
                        offset: lane * sign,
                        width: width,
                        casing: casing
                    })
                });
            }
        });
    }
    return styled;
}

// Splits the routes into the corridors they are travelling along, so that lanes
// are only handed out between routes that really do share a street. Without
// this, hovering a junction would fan every route crossing it off its own path.
function groupIntoCorridors(routes) {
    // Bearings run modulo 180 degrees: a street is one corridor, both ways.
    const byBearing = routes.slice().sort((a, b) => a.bearing - b.bearing);
    const corridors = [];
    for (const route of byBearing) {
        const current = corridors[corridors.length - 1];
        if (current && route.bearing - current[current.length - 1].bearing <= CORRIDOR_TOLERANCE_DEGREES) {
            current.push(route);
        } else {
            corridors.push([route]);
        }
    }
    // 179 degrees and 1 degree are two degrees apart, not 178.
    const last = corridors[corridors.length - 1];
    if (corridors.length > 1 &&
        corridors[0][0].bearing + 180 - last[last.length - 1].bearing <= CORRIDOR_TOLERANCE_DEGREES) {
        corridors[corridors.length - 1] = last.concat(corridors[0]);
        corridors.shift();
    }
    return corridors;
}

// Which way a route is heading where it passes the cursor. Longitude is squashed
// to match latitude so that the angle is a true one.
function localDirection(coordinates, anchor) {
    const cosLat = Math.cos(anchor[1] * Math.PI / 180);
    let nearest = 0;
    let nearestDistance = Infinity;
    for (let i = 0; i < coordinates.length; i++) {
        const dx = (coordinates[i][0] - anchor[0]) * cosLat;
        const dy = coordinates[i][1] - anchor[1];
        const distance = dx * dx + dy * dy;
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = i;
        }
    }
    const before = coordinates[Math.max(0, nearest - 1)];
    const after = coordinates[Math.min(coordinates.length - 1, nearest + 1)];
    return [(after[0] - before[0]) * cosLat, after[1] - before[1]];
}

// Places a route-number badge at each end of every highlighted route. Routes
// usually run well beyond the viewport, so the "end" is the outermost point of
// the route that is actually on screen.
function updateBadges() {
    const features = [];
    const seenLines = new Set();
    for (const route of highlightedGeojson.features) {
        const line = route.properties.line;
        if (seenLines.has(line)) {
            continue; // both directions of a route share a number - badge it once
        }
        seenLines.add(line);
        const colourIndex = route.properties.colourIndex;
        ensureBadgeImage(line, route.properties.colour, colourIndex);
        for (const coordinates of visibleEnds(route.geometry.coordinates)) {
            features.push({
                type: "Feature",
                geometry: {type: "Point", coordinates: coordinates},
                properties: {line: line, colourIndex: colourIndex}
            });
        }
    }
    badgeGeojson.features = features;
    map.getSource("bus_route_badges").setData(badgeGeojson);
}

function visibleEnds(coordinates) {
    const canvas = map.getCanvas();
    const pad = BADGE_VIEWPORT_PADDING;
    const maxX = canvas.clientWidth - pad;
    const maxY = canvas.clientHeight - pad;
    const onScreen = i => {
        const p = map.project(coordinates[i]);
        return p.x >= pad && p.x <= maxX && p.y >= pad && p.y <= maxY;
    };
    let first = 0;
    while (first < coordinates.length && !onScreen(first)) {
        first++;
    }
    if (first === coordinates.length) {
        return [];
    }
    let last = coordinates.length - 1;
    while (last > first && !onScreen(last)) {
        last--;
    }
    return first === last ? [coordinates[first]] : [coordinates[first], coordinates[last]];
}

// A route only keeps its colour for as long as it is highlighted, so a line
// needs one badge image per colour it can be drawn in.
function ensureBadgeImage(line, colour, colourIndex) {
    const name = 'badge-' + line + '-' + colourIndex;
    if (badgeImages.has(name)) {
        return;
    }
    const scale = 2;
    const height = 19;
    const paddingX = 6;
    const radius = 4;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = BADGE_FONT;
    const width = Math.ceil(ctx.measureText(line).width) + 2 * paddingX;
    canvas.width = width * scale;
    canvas.height = height * scale;
    ctx.scale(scale, scale); // resizing the canvas resets the context, so restate it
    ctx.font = BADGE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    roundedRectPath(ctx, 0.5, 0.5, width - 1, height - 1, radius);
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(line, width / 2, height / 2 + 1);
    map.addImage(name, ctx.getImageData(0, 0, canvas.width, canvas.height), {pixelRatio: scale});
    badgeImages.add(name);
}

function roundedRectPath(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
}
