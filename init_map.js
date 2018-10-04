const HIGHLIGHT_BBOX_SIZE = 5;

mapboxgl.accessToken = 'pk.eyJ1IjoiemV0dGVyIiwiYSI6ImVvQ3FGVlEifQ.jGp_PWb6xineYqezpSd7wA';

let allGeojson;
let highlightedGeojson = {"type": "FeatureCollection", "features": []};

var map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v10',
    center: [-0.142, 51.506],
    zoom: 10
});

map.on('load', () => $.getJSON('bus_routes.json', onGeojsonLoaded));

map.on('mousemove', function(e) {
    const bbox = [[e.point.x - HIGHLIGHT_BBOX_SIZE, e.point.y - HIGHLIGHT_BBOX_SIZE],
                  [e.point.x + HIGHLIGHT_BBOX_SIZE, e.point.y + HIGHLIGHT_BBOX_SIZE]];
    highlightedGeojson.features = map.queryRenderedFeatures(bbox, {layers: ['bus_routes']})
        .filter(f => !f.properties.line.startsWith("N"));
    console.log(highlightedGeojson.features);
    map.getSource("bus_routes_highlighted").setData(highlightedGeojson);
});

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
}

