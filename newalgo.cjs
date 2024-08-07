
const {run} = require("./sorteloc.cjs")
const fs = require('fs');
const axios = require('axios');
const polyline = require('@mapbox/polyline');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const port = 3000;

const accessToken = 'bc53649b-2a93-4a6b-97dd-a92e6ea02cc1';
const apiKey = '11f4fbb642920f3bdd0e6c2342d70f44';

const eLocApiUrl = 'https://atlas.mapmyindia.com/api/places/search/json';
const routeApiUrl = (startELoc, destinationELoc) =>
  `https://apis.mapmyindia.com/advancedmaps/v1/${apiKey}/route_adv/driving/${startELoc};${destinationELoc}?geometries=polyline&source=any&destination=any&steps=false&region=IND&roundtrip=false&overview=simplified`;

const fetchELoc = async (location) => {
  try {
    const { data } = await axios.get(eLocApiUrl, {
      params: { query: location },
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const eLoc = data.userAddedLocations?.[0]?.eLoc || data.suggestedLocations?.[0]?.eLoc;
    if (!eLoc) {
      throw new Error('Location not found.');
    }

    return eLoc;
  } catch (error) {
    throw new Error(`Error fetching eLoc for "${location}": ${error.message}`);
  }
};


const fetchRouteDetails = async (startELoc, destinationELoc) => {
  try {
    const apiUrl = routeApiUrl(startELoc, destinationELoc);
    const { data, status } = await axios.get(apiUrl);

    if (status !== 200 || !data.routes[0]) {
      throw new Error('No route details found or unexpected response status.');
    }

    const { geometry, duration, distance } = data.routes[0];
    const coordinates = polyline.decode(geometry);

    return { coordinates, duration, distance };
  } catch (error) {
    throw new Error(`Error fetching route details: ${error.message}`);
  }
};


const calculateDistance = ([lat1, lon1], [lat2, lon2]) => {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance = R * c;
  const distanceInKm = distance / 1000;
  return distanceInKm;
};

const areCoordinatesWithinRange = (coords1, coords2, maxDistance = 2) => {
  const checkProximity = (coord, coordsArray) => {
    for (const otherCoord of coordsArray) {
      if (calculateDistance(coord, otherCoord) <= maxDistance) {
        return true;
      }
    }
    return false;
  };

  const pickupCoords1 = coords1[0];
  const destinationCoords1 = coords1[coords1.length - 1];
  const pickupCoords2 = coords2[0];
  const destinationCoords2 = coords2[coords2.length - 1];

  if (
    (checkProximity(pickupCoords1, coords2) ||
      checkProximity(pickupCoords2, coords1)) &&
    (checkProximity(destinationCoords1, coords2) ||
      checkProximity(destinationCoords2, coords1))
  ) {
    return true;
  }

  return false;
};

const fetchCombinedRoute = async (group) => {
  try {
    const startELocs = group.routes.map((route) => route.startELoc).join(';');
    const destinationELocs = group.routes
      .map((route) => route.destinationELoc)
      .join(';');
    const apiUrl = routeApiUrl(startELocs, destinationELocs);
    const response = await axios.get(apiUrl);

    if (response.status !== 200) {
      throw new Error(`Unexpected response status: ${response.status}`);
    }

    const combinedRoute = response.data.routes[0];
    if (!combinedRoute) {
      throw new Error('No combined route details found.');
    }

    const coordinates = polyline.decode(combinedRoute.geometry);

    return {
      coordinates,
      duration: combinedRoute.duration,
      distance: combinedRoute.distance
    };
  } catch (error) {
    throw new Error(`Error fetching combined route: ${error.message}`);
  }
};

const fetchAndCompareRoutes = async (routes, maxDistance = 10) => {
  const routeDetails = [];

  for (const route of routes) {
    try {
      const startELoc = await fetchELoc(route.startingPoint);
      const destinationELoc = await fetchELoc(route.destination);

      // Log the places and their eLoc values
      //console.log(`Starting Point: ${route.startingPoint}, eLoc: ${startELoc}`);
      //console.log(`Destination: ${route.destination}, eLoc: ${destinationELoc}`);

      const details = await fetchRouteDetails(startELoc, destinationELoc);
      routeDetails.push({ ...route, startELoc, destinationELoc, ...details });
    } catch (error) {
      console.error(
        `Error fetching route details for ${route.startingPoint} to ${route.destination}: ${error.message}`
      );
    }
  }

  const groups = [];
  const usedRoutes = new Set();

  for (let i = 0; i < routeDetails.length; i++) {
    if (usedRoutes.has(i)) continue;

    let group = [routeDetails[i]];
    usedRoutes.add(i);
    let mergedRoute = [...routeDetails[i].coordinates];

    for (let j = i + 1; j < routeDetails.length && group.length < 3; j++) {
      if (!usedRoutes.has(j)) {
        const isWithinRange = areCoordinatesWithinRange(
          mergedRoute,
          routeDetails[j].coordinates,
          maxDistance
        );

        if (isWithinRange) {
          group.push(routeDetails[j]);
          mergedRoute = mergedRoute.concat(routeDetails[j].coordinates);
          usedRoutes.add(j);
        }
      }
    }

    if (group.length > 1) {
      const combinedRoute = await fetchCombinedRoute({ routes: group });
      combinedRoute[`eLocs`] = []
      for(let route of group){
        combinedRoute.eLocs.push(route.startELoc)
        combinedRoute.eLocs.push(route.destinationELoc)
      }

      // Log the eLocs of the combined route
      console.log(`Combined route eLocs: ${JSON.stringify(combinedRoute.eLocs)}`);
      combinedRoute[`coordinates`] = await run(combinedRoute.eLocs)
      
      groups.push({ routes: group, combinedRoute});
    }
  }
  console.log(groups)

  return groups;
};



const convertTimeToDate = (time) => {
  const today = new Date();
  const [hours, minutes] = time.split(':').map(Number);
  today.setHours(hours, minutes, 0, 0);
  return today;
};

const calculateRouteDurationAndDistance = async (
  startELoc,
  destinationELoc
) => {
  const routeDetails = await fetchRouteDetails(startELoc, destinationELoc);
  return {
    duration: routeDetails.duration,
    distance: routeDetails.distance
  };
};

const checkPickupTimeValidity = async (group, maxDelay = 40) => {
  const times = group.routes.map((route) =>
    convertTimeToDate(route.pickupTime).getTime()
  );
  const earliestPickupTime = Math.min(...times);
  const latestPickupTime = Math.max(...times);

  const etaTimes = group.routes.map((route) => {
    const pickupDate = convertTimeToDate(route.pickupTime);
    return new Date(pickupDate.getTime() + route.duration * 1000).getTime();
  });

  const earliestETA = Math.min(...etaTimes);
  const latestETA = Math.max(...etaTimes);

  // Calculate duration between each consecutive pickup point within the group
  for (let i = 0; i < group.routes.length - 1; i++) {
    const startELoc1 = await fetchELoc(group.routes[i].startingPoint);
    const startELoc2 = await fetchELoc(group.routes[i + 1].startingPoint);
    const { duration, distance } = await calculateRouteDurationAndDistance(
      startELoc1,
      startELoc2
    );

    group.routes[i].pickupDistanceToNext = distance;
    group.routes[i].pickupDurationToNext = duration;
  }

  // Marking pickup possible for the first and last routes
  group.routes[0].pickupPossible = true;
  group.routes[group.routes.length - 1].pickupPossible = true;

  // Check if the pickup within the same group is possible based on the duration to the next pickup point
  for (let i = 0; i < group.routes.length - 1; i++) {
    group.routes[i].pickupPossible =
      group.routes[i].pickupDurationToNext / 60 <= maxDelay;
  }

  return group;
};

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/compare-routes', async (req, res) => {
  const routes = req.body.routes;
  try {
    const comparedGroups = await fetchAndCompareRoutes(routes);
    const groupsWithPickupValidity = await Promise.all(
      comparedGroups.map((group) => checkPickupTimeValidity(group))
    );
    res.json(groupsWithPickupValidity);
  } catch (error) {
    console.error('Error comparing routes:', error.message);
    res.status(500).json({ error: 'Failed to compare routes' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});



