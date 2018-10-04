const HIGHLIGHT_BBOX_SIZE = 20;
const SelectionModeEnum = Object.freeze({NONE_SELECTED: "NONE_SELECTED", BBOX_SELECTED: "BBOX_SELECTED", LINE_SELECTED: "LINE_SELECTED"});

mapboxgl.accessToken = 'pk.eyJ1IjoiemV0dGVyIiwiYSI6ImVvQ3FGVlEifQ.jGp_PWb6xineYqezpSd7wA';

let allGeojson;
let highlightedGeojson = {"type": "FeatureCollection", "features": []};
let selectionMode = SelectionModeEnum.NONE_SELECTED;

var map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v10',
    center: [-0.142, 51.506],
    zoom: 10
});

map.on('load', () => $.getJSON('bus_routes.json', onGeojsonLoaded));

function onMapMouseMove(e) {
    let featuresAroundPoint;
    if (selectionMode === SelectionModeEnum.NONE_SELECTED) {
        featuresAroundPoint = getFeaturesAroundPoint(e.point, 'bus_routes');
        highlightedGeojson.features = featuresAroundPoint;
        map.getSource("bus_routes_highlighted").setData(highlightedGeojson);
    } else if (selectionMode === SelectionModeEnum.BBOX_SELECTED) {
        featuresAroundPoint = getFeaturesAroundPoint(e.point, 'bus_routes_highlighted')
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
    return map.queryRenderedFeatures(bbox, {layers: [layer]})
        .filter(f => !f.properties.line.startsWith("N"));
}

function onGeojsonLoaded(data) {
    allGeojson = data;
    map.addSource('bus_routes', {
        type: 'geojson',
        data: allGeojson
    });
    map.addSource('bus_routes_highlighted', {
        type: 'geojson',
        data: highlightedGeojson
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
    map.on('mousemove', onMapMouseMove);
    map.on('click', onMapClick);
}

