mapboxgl.accessToken = 'pk.eyJ1IjoiemV0dGVyIiwiYSI6ImVvQ3FGVlEifQ.jGp_PWb6xineYqezpSd7wA';

let allGeojson;
let highlightedGeojson = {"type": "FeatureCollection", "features": []};

var map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v10',
    center: [-0.142, 51.506],
    zoom: 10
});

map.on('load', function() {
    $.getJSON('bus_routes.json', onGeojsonLoaded);
});

map.on('mousemove', function(e) {
    var bbox = [[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]];
    highlightedGeojson.features = map.queryRenderedFeatures(bbox, {layers: ['bus_routes']});
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

