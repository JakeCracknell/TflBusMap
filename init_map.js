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

map.on('click', function() {
    highlightedGeojson.features = allGeojson.features.filter(f => f.properties.line === "33");
    map.getSource("bus_routes").setData(highlightedGeojson);
});

function onGeojsonLoaded(data) {
    allGeojson = data;
    map.addSource('bus_routes', {
        type: 'geojson',
        data: allGeojson
    });
    map.addLayer({
        id: 'bus_routes',
        type: 'line',
        source: 'bus_routes'
    });
}

