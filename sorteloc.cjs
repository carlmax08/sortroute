const axios = require('axios');

const mapMyIndiaApiKey = 'cb10bfd23550d2159b053990b249540e';

const getRouteDetails = async (startELoc, endELoc) => {
    const url = `https://apis.mapmyindia.com/advancedmaps/v1/${mapMyIndiaApiKey}/route_adv/driving/${startELoc};${endELoc}?geometries=geojson&source=any&destination=any&steps=false&region=IND&roundtrip=false&overview=simplified`;
    try {
        const response = await axios.get(url);
        return response.data.routes[0]; 
    } catch (error) {
        console.error('Error fetching route details:', error);
        throw error;
    }
};

// Function to calculate distances from the first eLoc to every other eLoc
const calculateDistancesFromReference = async (elocs) => {
    const referenceELoc = elocs[0];

    const routeDetailsPromises = elocs.slice(1).map(endELoc => getRouteDetails(referenceELoc, endELoc));
    const routes = await Promise.all(routeDetailsPromises);

    const sortedRoutes = routes
        .map((route, index) => ({
            referenceELoc,
            endELoc: elocs[index + 1],
            distance: route.distance,
            duration: route.duration,
        }))
        .sort((a, b) => a.distance - b.distance);

    // Extract sorted eLocs and include the reference eLoc at the beginning
    const sortedELocs = [referenceELoc, ...sortedRoutes.map(route => route.endELoc)];

    return sortedELocs;
};

// Function to hit Mappls API with sorted eLocs and extract coordinates
const hitMapplsApi = async (sortedELocs) => {
    const url = `https://apis.mappls.com/advancedmaps/v1/${mapMyIndiaApiKey}/route_eta/driving/${sortedELocs.join(';')}?geometries=geojson&rtype=0&steps=false&exclude=ferry&region=IND&alternatives=2&overview=simplified`;
    try {
        const response = await axios.get(url);

        const invertedCoordinates = response.data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
        return invertedCoordinates;
    } catch (error) {
        console.error('Error hitting Mappls API:', error);
        throw error;
    }
};

const run = async (elocs) => {
    if (!elocs || elocs.length < 2) {
        console.error('At least two eLocs are required.');
        process.exit(1);
    }

    try {
        const sortedELocs = await calculateDistancesFromReference(elocs);
        const coordinates = await hitMapplsApi(sortedELocs);
        console.log(coordinates);
        return coordinates;
    } catch (error) {
        console.error('Failed to calculate routes or hit Mappls API.', error);
    }
};

module.exports = { run };
