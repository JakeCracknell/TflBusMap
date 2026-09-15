const HIGHLIGHT_BBOX_SIZE = 20;
const BADGE_VIEWPORT_PADDING = 30;
const BADGE_FONT = "bold 13px Arial, Helvetica, sans-serif";
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
        highlightedGeojson.features = featuresAroundPoint;
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
        const selectedLine = getFeaturesAroundPoint(e.point, 'bus_routes_highlighted')[0];
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
    map.addLayer({
        id: 'bus_routes_highlighted',
        type: 'line',
        source: 'bus_routes_highlighted',
        paint: {
            "line-width": 5
        }
    });
    map.addLayer({
        id: 'bus_route_badges',
        type: 'symbol',
        source: 'bus_route_badges',
        layout: {
            "icon-image": "badge-{line}",
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
        ensureBadgeImage(line);
        for (const coordinates of visibleEnds(route.geometry.coordinates)) {
            features.push({
                type: "Feature",
                geometry: {type: "Point", coordinates: coordinates},
                properties: {line: line}
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

function ensureBadgeImage(line) {
    if (badgeImages.has(line)) {
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
    ctx.fillStyle = '#DC241F';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(line, width / 2, height / 2 + 1);
    map.addImage('badge-' + line, ctx.getImageData(0, 0, canvas.width, canvas.height), {pixelRatio: scale});
    badgeImages.add(line);
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
