mapboxgl.accessToken = 'pk.eyJ1IjoiemV0dGVyIiwiYSI6ImVvQ3FGVlEifQ.jGp_PWb6xineYqezpSd7wA';

var map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v10',
    center: [-0.142, 51.506],
    zoom: 10
});

map.on('load', function() {
    map.addSource('bus_routes', {
        type: 'geojson',
        data: 'bus_routes.json'
    });
    map.addLayer({
        id: 'bus_routes',
        type: 'line',
        source: 'bus_routes'
    });
});
