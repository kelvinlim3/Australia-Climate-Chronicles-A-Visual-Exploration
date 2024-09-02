// Constants
const START = { Year: 2000, Month: 1 };
const END = { Year: 2024, Month: 6 };
const MIN_TEMP = 0;
const MAX_TEMP = 35;
const INTERVAL_TIME = 300;
const TRANSITION_TIME = 200;

// Dimensions and projection
const mapWidth = 630;
const mapHeight = 570;
const legendWidth = 20;
const linePlotLeftMargin = 40;
const linePlotRightMargin = 30;
const linePlotHeight = 280;
const linePlotWidth = 470 - linePlotLeftMargin - linePlotRightMargin;

// Calculate the number of months in the period
const numMonths = (END.Year - START.Year) * 12 + (END.Month - START.Month + 1);
console.log(`The period is from ${formatYearAndMonth(START.Year, START.Month)} to ${formatYearAndMonth(END.Year, END.Month)} - spanning a total of ${numMonths} months.`);

// Data file paths
const regions_geo = "data/raw_data/regions/au-postcodes-Visvalingam-5.geojson";
const regions_with_temperatures = "data/aggregated_data/postcodes_with_monthly_temperatures_From20000101.csv";

// Initialise state
let regions, data, filteredData, temperaturesByYearAndMonth, intervalId, initialTransform;
let currentMonthOffset = 0;

// Tooltips
const tip1 = d3.select("#tooltip-1");
const tip2 = d3.select("#tooltip-2");

// Colour scale for temperatures
const tempScale = d3.scaleSequential(d3.interpolateCool)
    .domain([MIN_TEMP, MAX_TEMP]);

// Projection and path setup for the map
const projection = d3.geoMercator()
    .center([133.7751, -25.2744])
    .scale(750)
    .translate([mapWidth / 2, mapHeight / 2 - 40]);

const path = d3.geoPath().projection(projection);

// Create map SVG container
const mapSvg = d3.select("#map").append("svg")
    .attr("width", mapWidth)
    .attr("height", mapHeight);

// Setup zoom functionality
const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .on('zoom', zoomed);

mapSvg.call(zoom);

// Create line plot SVG container
const linePlotSvg = d3.select("#legend").append("svg")
    .attr("width", linePlotWidth + linePlotLeftMargin + linePlotRightMargin + legendWidth)
    .attr("height", mapHeight)
    .append("g")
    .attr('transform', `translate(${linePlotLeftMargin}, ${mapHeight / 3 - 40})`);

// Add legend for temperature scale
const legend = linePlotSvg.append('defs')
    .append("linearGradient")
    .attr("id", "gradient")
    .attr("x1", "0%")
    .attr("y1", "0%")
    .attr("x2", "0%")
    .attr("y2", "100%")
    .attr("spreadMethod", "pad");

// Declare the colour stops for the legend gradient
const colourStops = [
    { offset: "0%", colour: 1 },
    { offset: "16.7%", colour: 0.833 },
    { offset: "33.3%", colour: 0.667 },
    { offset: "50%", colour: 0.5 },
    { offset: "66.7%", colour: 0.333 },
    { offset: "83.3%", colour: 0.167 },
    { offset: "100%", colour: 0 }
];

// Append colour stops to the legend
legend.selectAll("stop")
    .data(colourStops)
    .enter()
    .append("stop")
    .attr("offset", d => d.offset)
    .attr("stop-color", d => d3.interpolateCool(d.colour))
    .attr("stop-opacity", 1);

linePlotSvg.append("rect")
    .attr("width", legendWidth)
    .attr("height", linePlotHeight)
    .style("fill", "url(#gradient)");

// Initialise line plot scales
const x = d3.scaleTime().range([legendWidth, legendWidth + 420]);
const y = d3.scaleLinear()
    .domain([MAX_TEMP, MIN_TEMP])
    .range([0, linePlotHeight]);

// Add axis generators
const xAxisCall = d3.axisBottom().tickFormat(d => formatYearAndMonth(d.getFullYear(), d.getMonth() + 1));
const yAxisCall = d3.axisLeft(y).tickFormat(d => `${d} °C`);

// Add axes to the line plot
const xAxis = linePlotSvg.append("g")
.attr("transform", `translate(0, ${linePlotHeight})`)
.attr("class", "axis");

const yAxis = linePlotSvg.append("g")
.attr("class", "axis")
.call(yAxisCall);

// Initialise line generator for plotting data
const lineGenerator = d3.line()
    .x(d => x(d['Date']))
    .y(d => y(d['Avg_temp']));


// Load the regions and temperature data
Promise.all([
    d3.json(regions_geo),
    d3.csv(regions_with_temperatures)
]).then(([regionsLoaded, dataLoaded]) => {
    // Assign the loaded data to variables
    regions = regionsLoaded;
    data = dataLoaded;

    // Prepare and clean data
    data.forEach(entry => {
        entry['Year'] = +entry['Year']; // Convert to number
        entry['Month'] = +entry['Month']; // Convert to number
        entry['Avg_temp'] = +entry['Avg_temp']; // Convert to number
    });

    // Filter data between START and END dates
    filteredData = data.filter(entry => {
        const { Year, Month } = entry;
        return (Year > START.Year || (Year === START.Year && Month >= START.Month)) &&
               (Year < END.Year || (Year === END.Year && Month <= END.Month));
    });

    // Initialise event listeners
    initialiseEventListeners();

    // Group data by formatted date string
    temperaturesByYearAndMonth = d3.group(
        filteredData,
        d => formatYearAndMonth(d['Year'], d['Month'])
    );

    // Initial updates for map, line plot, and pins
    updateMap();
    updateLinePlot();
    updatePins();

    // Store initial transform state (no zoom, no translation)
    initialTransform = d3.zoomIdentity;

    // Hide the loading overlay
    $('#loading-overlay').hide();
});


// Function to update the map
function updateMap() {
    // Initialise transition
    const t = d3.transition()
        .duration(TRANSITION_TIME)
        .ease(d3.easeLinear);

    // Calculate the current year and month from the month offset
    const yearAndMonth = yearAndMonthFromMonthOffset(currentMonthOffset);
    const yearAndMonthFormatted = formatYearAndMonth(yearAndMonth.Year, yearAndMonth.Month);
    
    // Retrieve data for the current month
    const monthData = temperaturesByYearAndMonth.get(yearAndMonthFormatted);
    const avgTemp = d3.mean(monthData, d => d['Avg_temp']);

    // Create a map of postcode temperatures for the selected date
    const regionTemperatures = new Map(monthData.map(d => [d['Postcode'], d['Avg_temp']]));

    // Select all regions and bind data
    const paths = mapSvg.selectAll('.regions')
        .data(regions.features);

    // Enter new paths for each data item and update existing ones
    paths.enter()
        .append('path')
        .attr('class', 'regions')
        .attr('d', path)
        .merge(paths)
        .on('mouseover', (event, d) => {
            // Show tooltip on hover
            const postcode = d.properties['POA_CODE'];
            const temp = regionTemperatures.get(postcode) || avgTemp;
            tip1.text(`Postcode: ${postcode}\nTemperature: ${temp.toFixed(1)}°C`)
                .style('visibility', 'visible');
        })
        .on('mousemove', (event) => {
            // Update tooltip on mouse move
            tip1.style('top', `${event.pageY}px`)
                .style('left', `${event.pageX}px`);
        })
        .on('mouseout', () => {
            // Hide tooltip on mouse out
            tip1.style('visibility', 'hidden');
        })
        .transition(t)
        .attr('fill', d => {
            // Set fill colour based on temperature
            const temp = regionTemperatures.get(d.properties['POA_CODE']) || avgTemp;
            return tempScale(temp);
        });

    // Update UI elements
    updateSliderColour(yearAndMonth.Month);
    $('#dateLabel').html(yearAndMonthFormatted);
    $('#date-slider').slider('value', currentMonthOffset);
}


// Function to update the line plot
function updateLinePlot() {
    // Initialise transition
    const t = d3.transition()
        .duration(TRANSITION_TIME)
        .ease(d3.easeLinear);

    // Define start and end dates for the x-axis
    const xStartDate = new Date(START.Year, START.Month - 1);
    const xEnd = yearAndMonthFromMonthOffset(currentMonthOffset);
    const xEndDate = new Date(xEnd.Year, xEnd.Month - 1);

    // Update x scale domain
    x.domain([xStartDate, xEndDate]);

    // Update x-axis with transition
    xAxisCall.scale(x);
    xAxis.transition(t)
        .call(xAxisCall)
        .selectAll("text")
        .attr("y", "10")
        .attr("x", "-5")
        .attr("text-anchor", "end")
        .attr("transform", "rotate(-40)");

    // Retrieve selected postcodes
    const postcode1 = $("#city-1").val();
    const postcode2 = $("#city-2").val();

    // Filter data for the selected postcodes within the date range
    const filteredData1 = filterDataByPostcodeAndDate(postcode1, xEnd);
    const filteredData2 = filterDataByPostcodeAndDate(postcode2, xEnd);

    // Prepare data structures for the line plot
    const data1 = formatDataForLinePlot(filteredData1);
    const data2 = formatDataForLinePlot(filteredData2);

    // Update lines with new data
    const lines = linePlotSvg.selectAll(".line")
        .data([
            { data: data1, colour: '#b74e32' }, 
            { data: data2, colour: '#b38b00' }
        ]);

    // Remove old lines
    lines.exit().remove();

    // Append new lines and update existing ones
    lines.enter()
        .append("path")
        .attr("class", "line")
        .merge(lines)
        .attr("d", d => lineGenerator(d.data))
        .attr("stroke", d => d.colour)
        .attr("fill", "none")
        .attr("stroke-width", 2);
}


// Function to update pins on the map
function updatePins() {
    // Declare postcode coordinates
    const postcodeCoordinates = [
        { postcode: "2000", city: "Sydney", coords: [151.2093, -33.8688] },
        { postcode: "3000", city: "Melbourne", coords: [144.9631, -37.8136] },
        { postcode: "4000", city: "Brisbane", coords: [153.0251, -27.4698] },
        { postcode: "6000", city: "Perth", coords: [115.8605, -31.9505] },
        { postcode: "5000", city: "Adelaide", coords: [138.6007, -34.9285] },
        { postcode: "2600", city: "Canberra", coords: [149.1300, -35.2809] },
        { postcode: "7000", city: "Hobart", coords: [147.3272, -42.8821] },
        { postcode: "0800", city: "Darwin", coords: [130.8456, -12.4634] }
    ];

    // Retrieve values of selected postcodes
    const postcode1 = $("#city-1").val();
    const postcode2 = $("#city-2").val();

    // Find data for the selected postcodes
    const data1 = postcodeCoordinates.find(d => d.postcode === postcode1);
    const data2 = postcodeCoordinates.find(d => d.postcode === postcode2);

    // Get the current zoom transform
    const currentTransform = d3.zoomTransform(mapSvg.node());

    // Data array for pins
    const pinData = [
        { coords: data1.coords, city: data1.city, fill: "#b74e32" },  // Data for the first circle
        { coords: data2.coords, city: data2.city, fill: "#b38b00" }   // Data for the second circle
    ];

    // Clear existing pins
    mapSvg.selectAll("circle").remove();

    // Bind data for circles and append them
    mapSvg.selectAll("circle")
        .data(pinData)
        .enter()
        .append("circle")
        .attr("cx", d => currentTransform.applyX(projection(d.coords)[0]))
        .attr("cy", d => currentTransform.applyY(projection(d.coords)[1]))
        .attr("r", 7)
        .style("fill", d => d.fill)
        .on('mouseover', (event, d) => {
            // Show tooltip on hover
            tip2.text(`${d.city}`)
                .style('visibility', 'visible')
                .style('color', d.fill);
        })
        .on('mousemove', event => {
            // Update tooltip position on mouse move
            tip2.style('top', (event.pageY) + 'px')
                .style('left', (event.pageX) + 'px');
        })
        .on('mouseout', () => {
            // Hide tooltip on mouse out
            tip2.style('visibility', 'hidden');
        });
}


// Function to initialise event listeners
function initialiseEventListeners() {
    // Play button event listener
    $('#play-button').on('click', function() {
        const button = $(this);
        if (button.text() === 'Play') {
            button.text('Pause');
            intervalId = setInterval(() => {
                currentMonthOffset += 1;
                if (currentMonthOffset < numMonths) {
                    updateMap();
                    updateLinePlot();
                } else {
                    currentMonthOffset = 0;
                    button.text('Play');
                    clearInterval(intervalId);
                }
            }, INTERVAL_TIME);
        } else { // When pausing
            button.text('Play');
            clearInterval(intervalId);
        }
    });

    // Reset button event listener
    $('#reset-time-button').on('click', () => {
        currentMonthOffset = 0;
        updateMap();
        updateLinePlot();
        $('#play-button').text('Play'); // Reset play button text
        clearInterval(intervalId);
    });

    // Date slider initialisation
    $("#date-slider").slider({
        min: 0,
        max: numMonths - 1,
        step: 1,
        slide: (event, ui) => {
            currentMonthOffset = ui.value;
            updateMap();
            updateLinePlot();
        },
        create: () => {
            updateSliderColour(START.Month);
        }
    });

    // Zoom controls event listeners
    $("#zoom-in").on("click", () => {
        zoom.scaleBy(mapSvg.transition().duration(TRANSITION_TIME), 1.2);
    });

    $("#zoom-out").on("click", () => {
        zoom.scaleBy(mapSvg.transition().duration(TRANSITION_TIME), 0.8);
    });

    $("#reset-zoom").on("click", () => {
        mapSvg.transition().duration(TRANSITION_TIME)
            .call(zoom.transform, initialTransform);
    });

    // City selection event listeners
    $("#city-1").on("change", () => {
        updateMap();
        updateLinePlot();
        updatePins();
    });

    $("#city-2").on("change", () => {
        updateMap();
        updateLinePlot();
        updatePins();
    });
}


// Helper function to calculate the year and month from a month offset
function yearAndMonthFromMonthOffset(monthOffset) {    
    const totalMonths = START.Month + monthOffset - 1; // Calculate total months from the start year and month

    const year = START.Year + Math.floor(totalMonths / 12); // Compute the year
    const month = (totalMonths % 12) + 1; // Compute the month

    return { Year: year, Month: month }; // Return the result as an object
}


// Helper function to format the year and month in the desired format
function formatYearAndMonth(year, month) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = monthNames[month - 1]; // Extract month name

    return `${monthName} ${year}`; // Return formatted date string
}


// Helper function to filter data by postcode and date
function filterDataByPostcodeAndDate(postcode, end) {
    return filteredData.filter(entry => {
        const year = entry['Year'];
        const month = entry['Month'];
        return (year > START.Year || (year === START.Year && month >= START.Month)) &&
               (year < end.Year || (year === end.Year && month <= end.Month)) &&
               (entry['Postcode'] === postcode);
    });
}

// Helper function to format data for the line plot
function formatDataForLinePlot(data) {
    return data.map(d => ({
        'Date': new Date(d['Year'], d['Month'] - 1),
        'Avg_temp': d['Avg_temp']
    }));
}


// Function to update slider colours based on the current month
function updateSliderColour(month) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = monthNames[month - 1];

    // Remove all existing slider range classes
    $('#date-slider').removeClass(function (index, className) {
        return (className.match(/ui-slider-range-\w+/g) || []).join(' ');
    });

    // Add the new slider range class based on the current month
    $('#date-slider').addClass(`ui-slider-range-${monthName}`);
}


// Function to address map zoom transformations
function zoomed(event) {
    const currentTransform = event.transform; // Get the current zoom transform

    // Apply transformation to all map paths
    mapSvg.selectAll("path")
        .attr("transform", currentTransform);

    // Adjust the pins to maintain their geographic position
    mapSvg.selectAll("circle")
        .attr("cx", d => currentTransform.applyX(projection(d.coords)[0])) // Adjust x-position with zoom
        .attr("cy", d => currentTransform.applyY(projection(d.coords)[1])); // Adjust y-position with zoom
}