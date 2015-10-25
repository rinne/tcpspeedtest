/*
 *  tcpspeedtest.js
 *
 *  A simple client/server implementation to measure TCP throughput
 *  between hosts. A test data is sent over the network either from
 *  server to client, client to server, or to both directions
 *  simultaneously. This is pretty simple hack.
 *
 *  Copyright (C) 2015 Timo J. Rinne <tri@iki.fi>
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License version 2 as
 *  published by the Free Software Foundation.
 */

var net = require('net');
var KeepTime = require('keeptime');

(function(av) {

	av.shift();
	var av0 = av.shift();
	var usage = 'Usage: node tcpspeedtest.js [--server | --client] [--generator | --sink] [addr] port'

	var addr = undefined;
	var port = undefined;
	var count = 0;
	var generator = undefined;
	var server = undefined;
	var noDelay = undefined;
	var timeoutId = undefined;
	var timeoutMs = undefined;
	var listener = undefined;
	var interval = undefined;
	var bufLen = undefined;
	var connection = new Set();
	var m;
	
	while ((av[0] !== undefined) && (m = av[0].match(/^--([^=]+)(=(.*))?$/))) {
		av.shift();
		var opt = m[1];
		var optarg = m[3];
		switch (opt) {
		case 'generator':
			if ((optarg !== undefined) || (generator !== undefined)) {
				throw new Error(usage);
			}
			generator = true;
			break;
		case 'sink':
			if ((optarg !== undefined) || (generator !== undefined)) {
				throw new Error(usage);
			}
			generator = false;
			break;
		case 'server':
			if ((optarg !== undefined) || (server !== undefined)) {
				throw new Error(usage);
			}
			server = true;
			break;
		case 'client':
			if ((optarg !== undefined) || (server !== undefined)) {
				throw new Error(usage);
			}
			server = false;
			break;
		case 'timeout':
			if ((optarg === undefined) ||
				(! optarg.match(/^([1-9]\d*(\.\d+)?)|(0\.[\d]*[1-9][\d]*)$/)) ||
				(timeoutMs !== undefined)) {
				throw new Error(usage);
			}
			timeoutMs = Math.max(Math.round(1000 * Number(optarg)), 1);
			break;
		case 'interval':
			if ((optarg === undefined) ||
				(! optarg.match(/^([1-9]\d*(\.\d+)?)|(0\.[\d]*[1-9][\d]*)$/)) ||
				(interval !== undefined)) {
				throw new Error(usage);
			}
			interval = Number(optarg);
			break;
		case 'write-length':
			if ((optarg === undefined) ||
				(! (m = optarg.match(/^([1-9]\d*)([kKmMgGtTpPeE]?)$/))) ||
				(bufLen !== undefined)) {
				throw new Error(usage);
			}
			bufLen = Number(m[1]);
			switch (m[2]) {
			case '':
				break;
			case 'k':
			case 'K':
				bufLen *= 1024;
				break;
			case 'm':
			case 'M':
				bufLen *= 1024 * 1024;
				break;
			case 'g':
			case 'G':
				bufLen *= 1024 * 1024 * 1024;
				break;
			case 't':
			case 'T':
				bufLen *= 1024 * 1024 * 1024 * 1024;
				break;
			case 'p':
			case 'P':
				bufLen *= 1024 * 1024 * 1024 * 1024 * 1024;
				break;
			case 'e':
			case 'E':
				bufLen *= 1024 * 1024 * 1024 * 1024 * 1024 * 1024;
				break;
			}
			if (bufLen > (64 * 1024 * 1024)) {
				throw new Error(usage);
			}
			break;
		case 'nodelay':
			if (noDelay !== undefined) {
				throw new Error(usage);
			}
			if (optarg === undefined) {
				optarg = 'yes';
			}
			switch (optarg) {
			case 'on':
			case 'yes':
			case 'enabled':
				noDelay = true;
				break;
			case 'off':
			case 'no':
			case 'disabled':
				noDelay = false;
				break;
			default:
				throw new Error(usage);
			}
			break;
		default:
			throw new Error(usage);
		}
		opt = undefined;
		optarg = undefined;
	}
	if (server === undefined) {
		server = false;
	}
	if (generator === undefined) {
		generator = (! server);
	}
	if (noDelay === undefined) {
		noDelay = false;
	}
	if (bufLen === undefined) {
		bufLen = 64 * 1024;
	}

	switch (av.length) {
	case 2:
		addr = av.shift();
		console.log('addr: ' + addr);
		// fallthrough
	case 1:
		port = av.shift();
		console.log('port: ' + port);
		break;
	default:
		throw new Error(usage);
	}

	m = port.match(/^(\d{1,5})$/);
	if ((! m) || (m[1] < 1) || (m[1] > 65535)) {
		throw new Error('Bad port. ' + usage);
	}
	port = Number(m[1]);
	if (addr !== undefined) {
		if (server) {
			m = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
			if ((! m) || (m[1] > 255) || (m[2] > 255) || (m[3] > 255) || (m[4] > 255)) {
				throw new Error('Bad address. ' + usage);
			}
			addr = ((Number(m[1])).toString() + '.' +
					(Number(m[2])).toString() + '.' +
					(Number(m[3])).toString() + '.' +
					(Number(m[4])).toString());
		}
	} else {
		addr = server ? '0.0.0.0' : '127.0.0.1';
	}

	var buf = undefined;
	if (generator) {
		var buf = '23456789abcdefghijklmnopqrstuvwxyzABCEFGHJKLMNPQRSTUVWXYZ';
		buf = buf.repeat(Math.ceil(bufLen / buf.length));
		if (buf.length > bufLen) {
			buf = buf.slice(0, bufLen);
		}
		while (buf.length < (1024 * 1024)) {
			buf = buf + buf;
		}
	}

	function end(ctx) {
		if (ctx.s === undefined) {
			return;
		}
		var t = (ctx.timer !== undefined) ? ctx.timer.get() : undefined;
		if ((t !== undefined) && (t <= 0.000001)) {
			t = 0.000001;
		}
		ctx.s.end();
		ctx.s.destroy();
		ctx.s = undefined;
		if (ctx.error) {
			console.log('Network error!');
		}
		if (t !== undefined) {
			console.log('closed connection #' + ctx.id +
						(((! generator) || (ctx.read.bytes > 0)) ?
						 ("\nREAD: " + ctx.read.bytes + ' in ' +  t.toFixed(2) + ' seconds ' +
						  Math.floor(ctx.read.bytes / t) + ' bytes/sec ' +
						  (ctx.read.bytes / t * 8 / 1024 / 1024).toFixed(2) + ' megabits/sec') :
						 '') +
						(generator ?
						 ("\nWRITE: " + ctx.write.bytes + ' in ' +  t.toFixed(2) + ' seconds ' +
					  Math.floor(ctx.write.bytes / t) + ' bytes/sec ' +
						  (ctx.write.bytes / t * 8 / 1024 / 1024).toFixed(2) + ' megabits/sec') :
						 '') +
						("\nConnection time: " + t.toFixed(2) + ' seconds'));
		}
		connection.delete(ctx);
		if ((! server) && (timeoutId !== undefined)) {
			clearTimeout(timeoutId);
			timeoutId = undefined;
		}
	}

	function send(ctx) {
		do {
			ctx.write.bytes += buf.length;
		} while(ctx.s.write(buf));
		if (interval !== undefined) {
			var t = ctx.timer.get();
			var dt = t - ctx.write.lastT;
			if (dt > interval) {
				var cbps = (8 * (ctx.write.bytes - ctx.write.lastB)) / dt;
				if ((ctx.write.bps === undefined) || (ctx.write.bps == 0)) {
					ctx.write.bps = cbps;
				} else {
					ctx.write.bps = (0.8 * ctx.write.bps) + (0.2 * cbps);
				}
				ctx.write.lastB = ctx.write.bytes;
				ctx.write.lastT = t;
				console.log('#' + ctx.id + ' WRITE: ' +
							(cbps / 1024 / 1024).toFixed(2) + ' mbps (current) ' +
							(ctx.write.bps / 1024 / 1024).toFixed(2) + ' mbps (rolling) ' +
							(ctx.write.bytes * 8 / t / 1024 / 1024).toFixed(2) + ' mbps (all)' +
							' t=' + t.toFixed(2) + 's');
			}
		}
	};
	
	function receive(ctx, data) {
		ctx.read.bytes += data.length;
		if (interval !== undefined) {
			var t = ctx.timer.get();
			var dt = t - ctx.read.lastT;
			if (dt > interval) {
				var cbps = (8 * (ctx.read.bytes - ctx.read.lastB)) / dt;
				if ((ctx.read.bps === undefined) || (ctx.read.bps == 0)) {
					ctx.read.bps = cbps;
				} else {
					ctx.read.bps = (0.8 * ctx.read.bps) + (0.2 * cbps);
				}
				ctx.read.lastB = ctx.read.bytes;
				ctx.read.lastT = t;
				console.log('#' + ctx.id + ' READ : ' +
							(cbps / 1024 / 1024).toFixed(2) + ' mbps (current) ' +
							(ctx.read.bps / 1024 / 1024).toFixed(2) + ' mbps (rolling) ' +
							(ctx.read.bytes * 8 / t / 1024 / 1024).toFixed(2) + ' mbps (all)' +
							' t=' + t.toFixed(2) + 's');

			}
		}
	}

	function killall() {
		if (listener !== undefined) {
			listener.close(function() {});
			listener = undefined;
		}
		connection.forEach(function(ctx) { end(ctx); });
	}
	
	if (server) {
		listener = net.createServer(function(s) {
			var ctx = { s: s,
						id: ++count,
						error: false,
						timer: new KeepTime(true),
						read: { bytes: 0, lastT: 0, lastB: 0, bps: undefined },
						write: { bytes: 0, lastT: 0, lastB: 0, bps: undefined } };
			console.log('new connection #' + ctx.id + ' from ' + s.remoteAddress);
			ctx.s.setNoDelay(noDelay);
			ctx.s.on('end', function() { end(ctx); });
			ctx.s.on('close', function() { end(ctx); });
			ctx.s.on('error', function() { ctx.error = true; end(ctx); });
			ctx.s.on('data', function(data) { receive(ctx, data); });
			connection.add(ctx);
			if (generator) {
				ctx.s.on('drain', function() { send(ctx); } );
				send(ctx);
			}
		}).listen(port, addr);
		console.log("Listening " + addr + ':' + port +
					' mode is ' + (generator ? 'generator' : 'sink'));
		if (timeoutMs !== undefined) {
			timeoutId = setTimeout(killall, timeoutMs);
		}
	} else {
		(function() {
			var ctx = { s: undefined,
						id: ++count,
						error: false,
						timer: undefined,
						read: { bytes: 0, lastT: 0, lastB: 0 },
						write: { bytes: 0, lastT: 0, lastB: 0 } };
			var s = net.connect({port: port, host: addr}, function() {
				if (ctx.s === undefined) {
					ctx.s = s;
				}
				ctx.s.setNoDelay(noDelay);
				console.log("Connected to " + addr + ':' + port +
							' mode is ' + (generator ? 'generator' : 'sink'));
				ctx.timer = new KeepTime(true);
				connection.add(ctx);
				if (timeoutMs !== undefined) {
					timeout = setTimeout(killall, timeoutMs);
				}
				if (generator) {
					send(ctx);
				}
			});
			if (ctx.s === undefined) {
				ctx.s = s;
			}
			ctx.s.on('data', function(data) { receive(ctx, data); });
			ctx.s.on('error', function(data) { ctx.error = true; end(ctx); });
			ctx.s.on('end', function(data) { end(ctx); });
			if (generator) {
				ctx.s.on('drain', function() { send(ctx); });
			}
		})();
	}
	
})(process.argv);
