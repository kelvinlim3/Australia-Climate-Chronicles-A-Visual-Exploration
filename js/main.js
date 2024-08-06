// Dimensions and projection
const mapWidth = 650;
const mapHeight = 550;
const legendWidth = 20;
const legendHeight = 250;

// Constants
const START = {Year: 2000, Month: 1}
const END = {Year: 2024, Month: 6}
const MIN_TEMP = 0;
const MAX_TEMP = 35;
const INTERVAL_TIME = 150;
const TRANSITION_TIME = 100;

// GeoJSON file with all regions combined
const regions_geo = "data/au-postcodes-Visvalingam-5.geojson";

// CSV file with regions and temperatures
const regions_with_temperatures = "data/postcodes_with_monthly_temperatures_From20000101.csv"

// Initialise state
let currentMonthOffset = 0;
let intervalId;
let initialTransform;

// Colour scale
const tempScale = d3.scaleSequential(d3.interpolateCool)
    .domain([MIN_TEMP, MAX_TEMP]);

// Projection and path setup
const projection = d3.geoMercator()
    .center([133.7751, -25.2744])
    .scale(700)
    .translate([mapWidth/2+30, mapHeight/2-30]);

const path = d3.geoPath().projection(projection);

// Create map SVG container
const mapSvg = d3.select("#map").append("svg")
    .attr("width", mapWidth)
    .attr("height", mapHeight);

// Zoom
const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .on('zoom', zoomed);
mapSvg.call(zoom);

// Tooltip
let tip = d3.select("#tooltip");

// Create legend SVG container
const legendSvg = d3.select("#legend").append("svg")
    .attr("width", 70)
    .attr("height", mapHeight)
    .append("g")
    .attr('transform', `translate(50, 120)`);

const legend = legendSvg.append('defs')
    .append("linearGradient")
    .attr("id", "gradient")
    .attr("x1", "0%")
    .attr("y1", "0%")
    .attr("x2", "0%")
    .attr("y2", "100%")
    .attr("spreadMethod", "pad");

// Define the color stops and their offsets
const colourStops = [
    { offset: "0%", colour: 1 },
    { offset: "20%", colour: 0.8 },
    { offset: "40%", colour: 0.6 },
    { offset: "60%", colour: 0.4 },
    { offset: "80%", colour: 0.2 },
    { offset: "100%", colour: 0 }
];

// Append stops to the legend
legend.selectAll("stop")
    .data(colourStops)
    .enter()
    .append("stop")
    .attr("offset", d => d.offset)
    .attr("stop-color", d => d3.interpolateCool(d.colour))
    .attr("stop-opacity", 1);

legendSvg.append("rect")
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .style("fill", "url(#gradient)");

const y = d3.scaleLinear()
    .domain([MAX_TEMP, MIN_TEMP])
    .range([0, legendHeight]);

const axisLeft = d3.axisLeft(y)
    .ticks(5)
    .tickFormat(d => `${d} °C`);

legendSvg.append("g")
    .attr("class", "axis")
    .call(axisLeft);

// Load the regions and temperature data
Promise.all([
    d3.json(regions_geo),
    d3.csv(regions_with_temperatures)
]).then(([regions, data]) => {
    console.log(regions)
    console.log(data)

    // Prepare and clean data
    data.forEach(entry => {
        entry['Year'] = Number(entry['Year']);
        entry['Month'] = Number(entry['Month']);
        entry['Avg_temp'] = Number(entry['Avg_temp']);
    });

    // Filter data between START and END
    const filteredData = data.filter(entry => {
        const year = entry['Year'];
        const month = entry['Month'];
        return (year > START.Year || (year === START.Year && month >= START.Month)) &&
               (year < END.Year || (year === END.Year && month <= END.Month));
    });

    // Find the minimum and maximum year and month
    const minYear = d3.min(filteredData, d => d['Year']);
    const minMonth = d3.min(filteredData.filter(d => d['Year'] === minYear), d => d['Month']);
    const maxYear = d3.max(filteredData, d => d['Year']);
    const maxMonth = d3.max(filteredData.filter(d => d['Year'] === maxYear), d => d['Month']);
    // Calculate the difference in months
    const numMonths = (maxYear - minYear) * 12 + (maxMonth - minMonth + 1);
    console.log(`The period is from ${formatYearAndMonth(minYear, minMonth)} to ${formatYearAndMonth(maxYear, maxMonth)} - spanning a total of ${numMonths} months.`);
    
    // Play button event listener
    $('#play-button')
        .on('click', function() {
            const button = $(this)
            if (button.text() === 'Play') {
                button.text('Pause')
                intervalId = setInterval(() => {
                    currentMonthOffset = (currentMonthOffset + 1) % numMonths; // Increment the current month offset
                    updateMap(currentMonthOffset);
                }, INTERVAL_TIME)
            }
            else { // When pausing
                button.text('Play')
                clearInterval(intervalId)
            }
        })
    
    // Reset button event listener
    $('#reset-time-button')
        .on('click', () => {
            currentMonthOffset = 0
            updateMap(currentMonthOffset);
        })
    
    // Date slider initialisation
    $("#date-slider")
        .slider({
            min: 0,
            max: numMonths-1,
            step: 1,
            slide: (event, ui) => {
                currentMonthOffset = ui.value;
                updateMap(currentMonthOffset);
                const yearAndMonth = yearAndMonthFromMonthOffset(currentMonthOffset);
                updateSliderColour(yearAndMonth.Month); // Update slider color based on the current date
            },
            create: () => {
                updateSliderColour(START.Month); // Set initial slider color
            }
        })

    // Zoom in button event listener
    $("#zoom-in")
        .on("click", () => {
            zoom.scaleBy(mapSvg.transition().duration(TRANSITION_TIME), 1.2);
    });

    // Zoom out button event listener
    $("#zoom-out")
        .on("click", () => {
            zoom.scaleBy(mapSvg.transition().duration(TRANSITION_TIME), 0.8);
    });

    // Reset zoom button event listener
    $("#reset-zoom")
        .on("click", () => {
            mapSvg.transition().duration(TRANSITION_TIME)
                .call(zoom.transform, initialTransform);
    });

    // Group data by date string
    const temperaturesByYearAndMonth = d3.group(filteredData, d => formatYearAndMonth(d['Year'], d['Month']));

    // Initial map update
    updateMap(currentMonthOffset);

    // Hide the loading overlay
    $('#loading-overlay').css('display', 'none');

    // Store initial transform state: no zoom, no translation
    initialTransform = d3.zoomIdentity;

    // Update map function
    function updateMap(monthOffset) {
        const yearAndMonth = yearAndMonthFromMonthOffset(monthOffset);
        const yearAndMonthFormatted = formatYearAndMonth(yearAndMonth.Year, yearAndMonth.Month);
        const monthData = temperaturesByYearAndMonth.get(yearAndMonthFormatted);
        const avgTemp = d3.mean(monthData, d => d['Avg_temp']);

        // Create a map of postcode temperatures for the selected date
        const regionTemperatures = new Map(
            monthData.map(d => [d['Postcode'], d['Avg_temp']])
        );

        // Initialise transition
        const t = d3.transition()
            .duration(TRANSITION_TIME)
            .ease(d3.easeLinear);
        
        // Append a group element and bind data to path elements
        const paths = mapSvg.selectAll('.regions')
            .data(regions.features);
            
        // Enter new paths for each data item
        paths.enter().append('path')
            .attr('class', 'regions')
            .attr('d', path)
            .merge(paths)
            .on('mouseover', (event, d) => {
                // Show tooltip on hover
                const postcode = d.properties['POA_CODE'];
                const temp = regionTemperatures.get(postcode) || avgTemp;
                tip.text(`Postcode: ${postcode}\nTemperature: ${temp.toFixed(1)}°C`);
                tip.style('visibility', 'visible');
            })
            .on('mousemove', event => {
                // Update tooltip position on mouse move
                tip.style('top', (event.pageY)+'px')
                    .style('left', (event.pageX)+'px')
            })
            .on('mouseout', () => {
                // Hide tooltip on mouse out
                tip.style('visibility', 'hidden');
            })
            .transition(t)
                .attr("fill", d => {
                    // Set fill color based on temperature
                    const temp = regionTemperatures.get(d.properties['POA_CODE']) || avgTemp;
                    return tempScale(temp);
                })

        
        // Update UI
        updateSliderColour(yearAndMonth.Month); // Update slider color based on the current date
        $('#dateLabel')[0].innerHTML = yearAndMonthFormatted;
        $('#date-slider').slider('value', monthOffset);
    }
})

// Function to get date from month offset
function yearAndMonthFromMonthOffset(monthOffset) {    
    // Calculate total months from the start year and month
    const totalMonths = START.Month + monthOffset - 1;
    
    // Compute the year and month
    const year = START.Year + Math.floor(totalMonths / 12);
    const month = (totalMonths % 12) + 1;

    return {Year: year, Month: month};
}

// Function to get year and month in desired format
function formatYearAndMonth(year, month) {
    // Extract month name
    const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month-1];
    // Construct and return the formatted date string
    return `${monthName} ${year}`;
}

// Function to get the current season based on the month
function getSeason(month) {
    if ([12, 1, 2].includes(month)) {
        return 'summer';
    } else if ([3, 4, 5].includes(month)) {
        return 'autumn';
    } else if ([6, 7, 8].includes(month)) {
        return 'winter';
    } else if ([9, 10, 11].includes(month)) {
        return 'spring';
    } else {
        return null; // Return null if the month is not valid
    }
}

// Update slider colors based on the current date
function updateSliderColour(month) {
    const season = getSeason(month);
    if (season) {
        $('#date-slider').removeClass('ui-slider-range-winter ui-slider-range-spring ui-slider-range-summer ui-slider-range-autumn')
                         .addClass(`ui-slider-range-${season}`);
        
        // Set the season label with appropriate colour
        $('#seasonLabel')
            .text(`(${season.charAt(0).toUpperCase() + season.slice(1)})`)
            .attr('class', `seasonLabel ${season}`);
    }
}

// Zoom function
function zoomed(event) {
    mapSvg.selectAll("path")
        .attr("transform", event.transform);
}