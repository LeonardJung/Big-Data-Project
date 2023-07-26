const os = require("os");
const dns = require("dns").promises;
const { program: optionparser } = require("commander");
const { Kafka } = require("kafkajs");
const mariadb = require("mariadb");
const MemcachePlus = require("memcache-plus");
const express = require("express");

const app = express();
const cacheTimeSecs = 15;
const numberOfProjects = 30;

// -------------------------------------------------------
// Command-line options (with sensible defaults)
// -------------------------------------------------------

let options = optionparser
  .storeOptionsAsProperties(true)
  // Web server
  .option("--port <port>", "Web server port", 3000)
  // Kafka options
  .option(
    "--kafka-broker <host:port>",
    "Kafka bootstrap host:port",
    "my-cluster-kafka-bootstrap:9092"
  )
  .option(
    "--kafka-topic-tracking <topic>",
    "Kafka topic to tracking data send to",
    "tracking-data"
  )
  .option(
    "--kafka-client-id < id > ",
    "Kafka client ID",
    "tracker-" + Math.floor(Math.random() * 100000)
  )
  // Memcached options
  .option(
    "--memcached-hostname <hostname>",
    "Memcached hostname (may resolve to multiple IPs)",
    "my-memcached-service"
  )
  .option("--memcached-port <port>", "Memcached port", 11211)
  .option(
    "--memcached-update-interval <ms>",
    "Interval to query DNS for memcached IPs",
    5000
  )
  // Database options
  .option("--mariadb-host <host>", "MariaDB host", "my-app-mariadb-service")
  .option("--mariadb-port <port>", "MariaDB port", 3306)
  .option("--mariadb-schema <db>", "MariaDB Schema/database", "popular")
  .option("--mariadb-username <username>", "MariaDB username", "root")
  .option("--mariadb-password <password>", "MariaDB password", "mysecretpw")
  // Misc
  .addHelpCommand()
  .parse()
  .opts();

// -------------------------------------------------------
// Database Configuration
// -------------------------------------------------------

const pool = mariadb.createPool({
  host: options.mariadbHost,
  port: options.mariadbPort,
  database: options.mariadbSchema,
  user: options.mariadbUsername,
  password: options.mariadbPassword,
  connectionLimit: 5,
});

async function executeQuery(query, data) {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log("Executing query ", query);
    let res = await connection.query({ rowsAsArray: true, sql: query }, data);
    return res;
  } finally {
    if (connection) connection.end();
  }
}

// -------------------------------------------------------
// Memcache Configuration
// -------------------------------------------------------

//Connect to the memcached instances
let memcached = null;
let memcachedServers = [];

async function getMemcachedServersFromDns() {
  try {
    // Query all IP addresses for this hostname
    let queryResult = await dns.lookup(options.memcachedHostname, {
      all: true,
    });

    // Create IP:Port mappings
    let servers = queryResult.map(
      (el) => el.address + ":" + options.memcachedPort
    );

    // Check if the list of servers has changed
    // and only create a new object if the server list has changed
    if (memcachedServers.sort().toString() !== servers.sort().toString()) {
      console.log("Updated memcached server list to ", servers);
      memcachedServers = servers;

      //Disconnect an existing client
      if (memcached) await memcached.disconnect();

      memcached = new MemcachePlus(memcachedServers);
    }
  } catch (e) {
    console.log("Unable to get memcache servers (yet)");
  }
}

//Initially try to connect to the memcached servers, then each 5s update the list
getMemcachedServersFromDns();
setInterval(
  () => getMemcachedServersFromDns(),
  options.memcachedUpdateInterval
);

//Get data from cache if a cache exists yet
async function getFromCache(key) {
  if (!memcached) {
    console.log(
      `No memcached instance available, memcachedServers = ${memcachedServers}`
    );
    return null;
  }
  return await memcached.get(key);
}

// -------------------------------------------------------
// Kafka Configuration
// -------------------------------------------------------

// Kafka connection
const kafka = new Kafka({
  clientId: options.kafkaClientId,
  brokers: [options.kafkaBroker],
  retry: {
    retries: 0,
  },
});

const producer = kafka.producer();

// Send tracking message to Kafka
async function sendTrackingMessage(data) {
  //Ensure the producer is connected
  await producer.connect();

  //Send message
  let result = await producer.send({
    topic: options.kafkaTopicTracking,
    messages: [{ value: JSON.stringify(data) }],
  });

  console.log("Send result:", result);
  return result;
}

// -------------------------------------------------------
// HTML helper to send a response to the client
// -------------------------------------------------------

function sendResponse(res, html) {
  res.send(`<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Big Data Research Institute</title>
			<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-9ndCyUaIbzAi2FUVXJi0CjmCapSmO7SnpJef0486qhLnuZ2cdeRhO02iuK6FUUVM" crossorigin="anonymous">
			<script>
				function fetchRandomProjects() {
					const maxRepetitions = Math.floor(Math.random() * 200)
					for(var i = 0; i < maxRepetitions; ++i) {
						const projectId = Math.floor(Math.random() * ${numberOfProjects})
						console.log("Fetching project id " + projectId)
						fetch("/projects/" + projectId, {cache: 'no-cache'})
					}
				}
			</script>
		</head>
		<body>
			<nav class="navbar navbar-expand-lg navbar-dark bg-dark">
				<div class="container-fluid">
					<a class="navbar-brand" href="/">
						BDRI
					</a>
					<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarContent" aria-controls="navbarContent" aria-expanded="false" aria-label="Toggle navigation">
						<span class="navbar-toggler-icon"></span>
					</button>
					<div class="collapse navbar-collapse" id="navbarContent">
						<ul class="navbar-nav me-auto mb-2 mb-lg-0">
							<li class="nav-item dropdown">
								<a class="nav-link" href="/projects">Our Projects</a>
							</li>
						</ul>
					</div>
				</div>
			</nav>

			<div class="container mt-5">
				${html}
			</div>

			<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js" integrity="sha384-geWF76RCwLtnZ8qwWowPQNguL3RmwHVBC9FhGdlKrxdiJJigb/j/68SIy3Te4Bkz" crossorigin="anonymous"></script>
		</body>
	</html>
	`);
}

// -------------------------------------------------------
// Start page
// -------------------------------------------------------

// Get list of projects (from cache or db)
async function getProjects() {
  const key = "projects";
  let cachedata = await getFromCache(key);

  if (cachedata) {
    console.log(`Cache hit for key=${key}, cachedata = `, cachedata);
    return { result: cachedata, cached: true };
  } else {
    console.log(`Cache miss for key=${key}, querying database`);
    const data = await executeQuery(
      "SELECT id, title, description FROM projects",
      []
    );
    if (data) {
      let result = data.map((row) => ({
        id: row?.[0],
        title: row?.[1],
        description: row?.[2],
      }));
      console.log("Got result=", result, "storing in cache");
      if (memcached) await memcached.set(key, result, cacheTimeSecs);
      return { result, cached: false };
    } else {
      throw "No projects data found";
    }
  }
}

// Get popular projects (from db only)
async function getPopular(maxCount) {
  const query =
    "SELECT project, count FROM popular ORDER BY count DESC LIMIT ?";
  return (await executeQuery(query, [maxCount])).map((row) => ({
    project: row?.[0],
    count: row?.[1],
  }));
}

app.get("/", (req, res) => {
  const topX = 6;
  Promise.all([getProjects(), getPopular(topX)]).then((values) => {
    const projects = values[0];
    const popular = values[1];

    let projectTable = [];
    projects.result.forEach((project) => {
      projectTable[project.id] = project;
    });

    const popularHtml = popular
      .map(
        (pop) => `
				<div class="col-sm-4 mb-4">
					<div class="card">
						<div class="card-body">
							<h5 class="card-title">${projectTable[pop.project].title}</h5>
							<p class="card-text">${projectTable[pop.project].description}</p>
							<a href='projects/${pop.project}'>Read more</a>
						</div>
					</div>
				</div>
			`
      )
      .join("\n");

    sendResponse(
      res,
      `
			<h1>Big Data Research Institute</h1>

			<p>Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.</p>

			<div class="row">
				${popularHtml}
			</div>
		`
    );
  });
});

app.get("/projects", (req, res) => {
  const topX = 6;
  Promise.all([getProjects(), getPopular(topX)]).then((values) => {
    const projects = values[0];
    const popular = values[1];

    let projectTable = [];
    projects.result.forEach((project) => {
      projectTable[project.id] = project;
    });

    const popularHtml = popular
      .map(
        (pop) => `
				<div class="card mb-4">
					<div class="card-body">
						<h5 class="card-title">${projectTable[pop.project].title} (${
          pop.count
        } views)</h5>
						<p class="card-text">${projectTable[pop.project].description}</p>
						<a href='projects/${pop.project}'>Read more</a>
					</div>
				</div>
			`
      )
      .join("\n");

    const projectsHtml = projects.result
      .map(
        (m) =>
          `<p><a href='projects/${m.id}'>${m.title}</a> - ${m.description}</p>`
      )
      .join("\n");

    const html = `
			<h1>Popular Projects</h1>
			${popularHtml}

			<h1>All Projects</h1>
			${projectsHtml}
		`;
    sendResponse(res, html);
  });
});

// -------------------------------------------------------
// Get a specific project (from cache or DB)
// -------------------------------------------------------

async function getProject(project) {
  const query = "SELECT title, description, text FROM projects WHERE id = ?";
  const key = "project_" + project;
  let cachedata = await getFromCache(key);

  if (cachedata) {
    console.log(`Cache hit for key=${key}, cachedata = ${cachedata}`);
    return { ...cachedata, cached: true };
  } else {
    console.log(`Cache miss for key=${key}, querying database`);

    let data = (await executeQuery(query, [project]))?.[0]; // first entry
    if (data) {
      let result = {
        title: data?.[0],
        description: data?.[1],
        text: data?.[2],
      };
      console.log(`Got result=${result}, storing in cache`);
      if (memcached) await memcached.set(key, result, cacheTimeSecs);
      return { ...result, cached: false };
    } else {
      throw "No data found for this project";
    }
  }
}

app.get("/projects/:project", (req, res) => {
  let project = req.params["project"];

  // Send the tracking message to Kafka
  sendTrackingMessage({
    project,
    timestamp: Math.floor(new Date() / 1000),
  })
    .then(() =>
      console.log(
        `Sent project=${project} to kafka topic=${options.kafkaTopicTracking}`
      )
    )
    .catch((e) => console.log("Error sending to kafka", e));

  // Send reply to browser
  getProject(project)
    .then((data) => {
      let htmlText = data.text
        .split("\n")
        .map((p) => `<p>${p}</p>`)
        .join("\n");
      sendResponse(
        res,
        `
			<h1>${data.title}</h1>
			<p>${data.description}<p>
			<hr>
			${htmlText}
		`
      );
    })
    .catch((err) => {
      sendResponse(res, `<h1>Error</h1><p>${err}</p>`, false);
    });
});

// -------------------------------------------------------
// Main method
// -------------------------------------------------------

app.listen(options.port, function () {
  console.log("Node app is running at http://localhost:" + options.port);
});
