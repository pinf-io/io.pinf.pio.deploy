
const VFS_LOCAL = require("vfs-local");
const NET = require('net');
const VFS_SOCKET_WORKER = require('vfs-socket/worker').Worker;
const VFS_SOCKET_TRANSPORT = require('vfs-socket/worker').smith.Transport;
const BUNYAN = require('bunyan');


require('org.pinf.genesis.lib').forModule(require, module, function (API, exports) {

console.log("API.config", API.config);

	console.log("SYNC vfs-socket-server API LOADED!", API.config);


	var logger = BUNYAN.createLogger({
		name: "io.pinf.proxy"
	});

	var vfs = VFS_LOCAL({
		root: __dirname,
		checkSymlinks: true
	});

	var worker = new VFS_SOCKET_WORKER(vfs);

	NET.createServer(function handler (socket) {

		logger.log("Socket", socket);

		var transport = new VFS_SOCKET_TRANSPORT(socket, socket, "worker");

		worker.connect(transport, function (err, remote) {
			if (err) throw err;

		});
		worker.on("disconnect", function (err) {
			if (err) throw err;

		});

	}).listen(
		API.config.port,
		API.config.bind
	);
  });

console.log("Server listening at: http://" + API.config.host + ":" + API.config.port);


});
