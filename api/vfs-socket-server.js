
const VFS_LOCAL = require("vfs-local");
const NET = require('net');
const VFS_SOCKET_WORKER = require('vfs-socket/worker').Worker;
const VFS_SOCKET_TRANSPORT = require('vfs-socket/worker').smith.Transport;
const BUNYAN = require('bunyan');

const STREAM_ROUTER = require("stream-router");
const MUX_DEMUX = require('mux-demux/msgpack');


require('org.pinf.genesis.lib').forModule(require, module, function (API, exports) {

	var keypair = API.FORGE.pki.rsa.generateKeyPair({
		bits: 1024,
		e: 0x10001
	});
	var incomingPrivateKey = keypair.privateKey;


	var config = API.config["vfs-socket-server"];

	var logger = BUNYAN.createLogger({
		name: "io.pinf.pio.sync-vfs-socket-server"
	});

	logger.info("config", config);


	var vfs = VFS_LOCAL({
		root: "/",
		checkSymlinks: true
	});

	var worker = new VFS_SOCKET_WORKER(vfs);


	NET.createServer(function handler (socket) {

		logger.info("New socket connection");

		var streamRouter = STREAM_ROUTER();

		function hookAuthorizedRoutes () {

			streamRouter.addRoute("/vfs", function (socket, params) {

				logger.info("New /vfs socket channel");

				var transport = new VFS_SOCKET_TRANSPORT(socket, true, "io.pinf.pio.sync-vfs-socket-server-worker");

				worker.connect(transport, function (err, remote) {
					if (err) throw err;

				});
				worker.on("disconnect", function (err) {
					if (err) throw err;

				});
			});

		}

		streamRouter.addRoute("/auth", function (socket, params) {

			logger.info("New auth request");

			socket.on("data", function (data) {

				API.JWT.verify(data, config.publicKey, {
					algorithms: [
						'RS256'
					]
				}, function(err, decoded) {
					if (err) {
						console.error("err", err.stack);
						logger.info("Auth failure");
						socket.write("FAILED");
						return;
					}
					if (
						decoded &&
						decoded.identityInfo === "TODO"
					) {
						logger.info("Auth success.");
						try {
							hookAuthorizedRoutes();
							socket.write(API.FORGE.pki.publicKeyToPem(keypair.publicKey));
						} catch (err) {
							console.error(err.stack);
						}
						logger.info("Sent auth response.");
						return;
					}
					socket.write("FAILED");
					return;
				});
			});
		});


	    var mdm = MUX_DEMUX({
	        error: false
	    })

	    mdm.on("connection", streamRouter)

		// TODO: Use 'incomingPrivateKey' (once set after auth) to decrypt incoming data then delegate to routes
		// TODO: Use 'config.publicKey' to encrypt outgoing data then delegate to socket
	    socket.pipe(mdm).pipe(socket)

	}).listen(
		config.port,
		config.bind
	);

	logger.info("Server listening at", "http://" + config.bind + ":" + config.port);

});
