//require stuff
//{
var zlib = require('zlib');

var http = require('http');
var uuid = require('uuid/v4');
var mysql = require('mysql');
var websocketServer = require('websocket').server;
var Winston = require('winston');
var path = require('path');

var conf = require('./config.json');
//}

//init variables
//{
var cl = [];
var lastFiftyCalls = [];
var next_change_id = "0";
var startTime;
var doneTime;
var difTime;
var league = "Legacy";
var server = http.createServer(function (request, response) {
    console.log((new Date()) + ' Received request for ' + request.url);
    response.writeHead(404);
    response.end();
});
var mysqlConnection = mysql.createConnection({
		host: conf.mysql.host,
		user: conf.mysql.user,
		password: conf.mysql.password,
		database: conf.mysql.database
	});
//}

//winston config
//{
const logger = new Winston.Logger({
    level: 'info',
    transports: [
        new Winston.transports.Console({
            timestamp: true
        }),
        new Winston.transports.File({
            filename: path.join(__dirname, '/logs/stuff.log'),
            timestamp: true
        })
    ]
});
//}

//start recursive calls for parsing GGG API
//{
start();
//}

//connect to mysql
//{
mysqlConnection.connect();
//}

//create http server and listen on config.port (19888)
//{
server.listen(conf.port, function () {
	console.log((new Date()) + ' Server is listening on port ' + conf.port);
});
//}

//create websocket server, define actions onMsg etc, define functions to only be used by the core WS code (origincheck)
//{
wsServer = new websocketServer({
		httpServer: server,
		autoAcceptConnections: false
	});

wsServer.on('request', function (request) {
	if (!originIsAllowed(request.origin)) {
		request.reject();
		console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
		return false;
	}

	var connection = request.accept('poexile-livesearch', request.origin);
	var _uuid = uuid();
	var _cl = {};
	cl.push(_cl);

	//assign values to object
	_cl.id = _uuid;
	_cl.connection = connection;

	//log and update clients-client-count
	console.log("clients: " + cl.length);
	sendToAllConnectedClients({
		"clients": cl.length
	});

	console.log((new Date()) + ' Connection from origin ' + request.origin + ' accepted.');

	connection.on('message', function (message) {
		if (message.type === 'utf8') {
			var _json = JSON.parse(message.utf8Data);

			if (_json.searchterm !== undefined) {
				_cl.searchterm = _json.searchterm;
			}

			if (_json.maxValue !== undefined && _json.maxValueType !== undefined) {
				_cl.maxValue = _json.maxValue;
				_cl.maxValueType = _json.maxValueType;
			}
		}
	});
	connection.on('close', function (reasonCode, description) {
		console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.');

		var _cli = cl.indexOf(_cl);
		if (_cli > -1) {
			cl.splice(_cli, 1);
		}

		sendToAllConnectedClients({
			"clients": cl.length
		});
	});
});
function originIsAllowed(origin) {
    console.log(origin);
	return true;
}
//}

//define helper functions
//{

//helper functions for ws.clients
//{
function sendToAllConnectedClients(obj) {
	cl.forEach(function (c) {
		var _c = c.connection;
		_c.send(JSON.stringify(obj));
	});
}
function getClientForId(id) {
	var client = false;

	cl.forEach(function (c) {
		if (client !== false)
			return false;

		if (c.id == id)
			client = c.connection;
	});

	return client;
}
function getSearchterms() {
	var searchterms = [];
	cl.forEach(function (c) {
		if (c.searchterm !== undefined)
			searchterms.push({
				"searchterm": c.searchterm,
				"id": c.id
			});
	});

	return searchterms;
}
//}

//helper functions for consuming poe.ninja API
//{
function getLatestChangeIdFromPoeNinja(callback) {
	var options = {
		host: 'api.poe.ninja',
		port: '80',
		path: '/api/Data/GetStats',
		method: 'GET',
		headers: {
			'Accept-Encoding': 'gzip,deflate'
		}
	};

	http.request(options, function (res) {
		var chunks = [];

		res.on('data', function (chunk) {
			chunks.push(chunk);
		});

		res.on('end', function () {
			var body = Buffer.concat(chunks);

			var encoding = res.headers['content-encoding'];

			if (encoding == 'gzip') {
				zlib.gunzip(body, function (err, res) {
					var json = JSON.parse(res);
					callback(err, json);
				});
			} else if (encoding == 'deflate') {
				zlib.inflate(body, function (err, res) {
					var json = JSON.parse(res);
					callback(err, json);
				});
			} else {
				var json = JSON.parse(body);
				callback(null, json);
			}
		});

		res.on('error', callback);
	})
	.on('error', callback)
	.end();
}
//}

//helper functions for consuming the GGG API
//{
function consume(change_id, callback) {
	var options = {
		host: 'www.pathofexile.com',
		port: '80',
		path: '/api/public-stash-tabs?id=' + change_id,
		method: 'GET',
		headers: {
			'Accept-Encoding': 'gzip,deflate'
		}
	};

	http.request(options, function (res) {
		var chunks = [];

		res.on('data', function (chunk) {
			chunks.push(chunk);
		});

		res.on('end', function () {
			var body = Buffer.concat(chunks);

			var encoding = res.headers['content-encoding'];

			if (encoding == 'gzip') {
				zlib.gunzip(body, function (err, res) {
					var json = JSON.parse(res);
					callback(err, json);
				});
			} else if (encoding == 'deflate') {
				zlib.inflate(body, function (err, res) {
					var json = JSON.parse(res);
					callback(err, json);
				});
			} else {
				var json = JSON.parse(body);
				callback(null, json);
			}
		});

		res.on('error', callback);
	})
	.on('error', callback)
	.end();
}
function consumeCallback(err, res) {
	if (err) {
        logger.info('Error!', { error: err});
		return console.log('Error: ', err);
	}

	//update change-ids on clients
	var o = {};
	o.current_change_id = next_change_id;
	o.next_change_id = res.next_change_id;
	sendToAllConnectedClients(o);

	//console.log(next_change_id);
	//console.log(res.next_change_id);
	next_change_id = res.next_change_id;

	doneTime = new Date().getTime();
	difTime = doneTime - startTime;

	//save time here
	addLastFiftyCalls(difTime);

	var o = {};
	o.lastCall = difTime;
	o.avgLastFiftyCalls = avgLastFiftyCalls();
	persistChangeIdTimeToMysql(next_change_id, difTime);
	sendToAllConnectedClients(o);

	//start parsing stashes here
	scanStashes(res.stashes);

	if (difTime > 1000) {
        logger.info("[delay:0s] GGG API CALL", next_change_id);
		startTime = new Date().getTime();
		consume(next_change_id, consumeCallback);
	} else {
        logger.info("[delay:1s] GGG API CALL", next_change_id);
		startTime = new Date().getTime();
		setTimeout(function () {
			consume(next_change_id, consumeCallback);
		}, 1000);
	}
}
//}

//helper functions for parsing the Stashtabs (+statistics)
//{
function scanStashes(stashes) {
	var searchterms = getSearchterms();

	searchterms.forEach(function (s) {
		stashes.forEach(function (stash) {
			var accountName = stash.accountName;
			var characterName = stash.lastCharacterName;
			var items = stash.items;
			var stashName = stash.stash;

			items.forEach(function (item) {
				if (item.league !== league) {
					return;
				}

				var isDivinationCard = false;

				if (item.name === undefined || item.name === "") { //divination cards
					item.name = item.typeLine;
					isDivinationCard = true;
				}
               
				//more conditions, league (see above), price, stats...
				if (item.name.toLowerCase().indexOf(s.searchterm.toLowerCase()) > -1) {
					var client = getClientForId(s.id);

					var isPriced = false;
					var isVerified = item.verified;
					var itemName = (isDivinationCard ? item.name.replace(/<<.*>>/, '') : item.name.replace(/<<.*>>/, '') + " " + item.typeLine);
					var whisper;

					if (item.note !== undefined)
						isPriced = (item.note.indexOf("~b/o") > -1 || item.note.indexOf("~price") > -1 ? true : false);

					if (isPriced) {
						whisper = '@' + characterName + ' Hi, I would like to buy your ' + itemName + ' listed for ' + convertToPrice(item.note) + ' in ' + item.league + ' (stash tab "' + stashName + '"; position: left ' + item.x + ', top ' + item.y + ')';
					} else {
						whisper = '@' + characterName + ' Hi, I would like to buy your ' + itemName + ' in ' + item.league + ' (stash tab "' + stashName + '"; position: left ' + item.x + ', top ' + item.y + ')';
					}

					client.send(
						JSON.stringify({
							'entry': {
								'item': {
									'id': item.id,
									'name': item.name,
									'icon': item.icon,
									'note': item.note,
									'priceInChaos': convertNoteToChaosPrice(item.note),
                                    'sockets': getSockets(item.sockets),
                                    'links': getLinks(item.sockets)
								},
								'isPriced': isPriced,
								'isVerified': isVerified,
								'user': {
									"accountName": accountName,
									"characterName": characterName
								},
								'whisper': whisper,
                                'datetime': new Date().toISOString()
							}
						})
                    );
				}
			});
		});

	});
}
function addLastFiftyCalls(c) {
	if (lastFiftyCalls.length > 49) {
		lastFiftyCalls.shift();
	}

	lastFiftyCalls.push(c);
}
function avgLastFiftyCalls() {
	if (lastFiftyCalls.length > 0) {
		var size = lastFiftyCalls.length;
		var total = 0;
		lastFiftyCalls.forEach(function (i, e) {
			total = total + i;
		});
		//console.log("total time: "+ total);
		//console.log("size / entries: "+size);
		//console.log("avg: "+(total/size));

		return total / size;
	} else {
		return 0;
	}
}
function persistChangeIdTimeToMysql(changeId, t) {
	mysqlConnection.query('INSERT INTO `poexile_search`.`change_id-times` (`change_id`, `time_ms`, `created_at`) VALUES ("' + changeId + '", ' + t + ', NOW());', function (err, rows, fields) {
		if (!err) {
			//noop
		} else {
			console.log('Error while performing Query:', err);
		}
	});
}
function convertNoteToChaosPrice(note) {
	if (note !== undefined) {
		var noteStripped = note.replace(/\~price /, '').replace(/\~b\/o /, '');

		return _convertNoteToChaosPrice(noteStripped);
	} else {
		return -1;
	}
}
function _convertNoteToChaosPrice(ns) {
	var ret = 0;

	if (ns.indexOf('exa') > -1) {
		ret = parseFloat(ns) * 88; //exalt ratio, Get this from poe.ninja
	}
	if (ns.indexOf('chaos') > -1) {
		ret = parseFloat(ns);
	} else {
		ret = -1;
	}

	return ret;
}
function convertToPrice(note) {
	//note == "~b/o 10 exa";
	//note == "~price 10 exa";
	var noteStripped = note.replace(/\~price /, '').replace(/\~b\/o /, '');

	return convertToPriceNotation(noteStripped);
}
function convertToPriceNotation(ns) {
	var ret = "";

	if (ns.indexOf('exa') > -1) {
		ret = parseFloat(ns) + " exalted";
	} else if (ns.indexOf('chaos') > -1) {
		ret = parseFloat(ns) + " chaos";
	} else if (ns.indexOf('alch') > -1) {
		ret = parseFloat(ns) + " alchemy";
	} else if (ns.indexOf('alt') > -1) {
		ret = parseFloat(ns) + " alteration";
	} else if (ns.indexOf('fuse') > -1) {
		ret = parseFloat(ns) + " fusing";
	} else if (ns.indexOf('jew') > -1) {
		ret = parseFloat(ns) + " jewellers";
	} else {
		ret = ns;
	}

	return ret;
}
function getSockets(socketsArray) {
    return socketsArray.length;
}
function getLinks(socketsArray) {
    var groups = {};
    
    socketsArray.forEach( function(o) {
        if(groups[o.group] === undefined) {
            groups[o.group] = 1;
        }
        else {
            groups[o.group]++;
        }
    });
    
    return groups;
}
//}

//helper functions for general purpose
//{
function start() {
	console.log("poe.ninja - getting latest change_id...");
	getLatestChangeIdFromPoeNinja(function (err, res) {
		if (err) {
			return console.log('Error: ', err);
		}

		startTime = new Date().getTime();
		next_change_id = res.nextChangeId;
		console.log("GGG API calls start @", next_change_id);

		consume(next_change_id, consumeCallback);
	});
}
//}

//}