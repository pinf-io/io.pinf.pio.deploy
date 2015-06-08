
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

	NET.createServer(function handler (socket) {

		logger.info("New socket connection");

		var vfs = VFS_LOCAL({
			root: "/",
			checkSymlinks: true
		});

		function handleRemoteProcedureCall (apiAlias, method, args) {
			if (
				typeof API[apiAlias] === "undefined" ||
				typeof API[apiAlias].for !== "function"
			) {
				throw new Error("API with alias '" + apiAlias + "' not found!");
			}
			return API.Q.when(API[apiAlias].for(API)).then(function (api) {
				if (!api) {
					throw new Error("API with alias '" + apiAlias + "' could not be loaded!");
				}
				if (typeof api[method] !== "function") {
					throw new Error("Method '" + method + "' not implemented for API with alias '" + apiAlias + "'");
				}
				console.log("Handle remote procedure call:", apiAlias, method, args);
				return API.Q.when(api[method](args));
			});
		}

		vfs.on("io.pinf.pio.sync:rpc:request", function (event) {
			try {
				handleRemoteProcedureCall(
					event.method,
					event.params.method,
					event.params.args
				).then(function (response) {
					vfs.emit(
						"io.pinf.pio.sync:rpc:response",
						API.JSONRPC.success(
							event.id,
							response
						),
						function (err) {
							if (err) {
								console.error("Error sending RPC success response:", err.stack);
							}
						}
					);
				}, function (err) {
					throw err;
				});
			} catch (err) {
				console.error('Error in RPC request handler', err.stack);
				vfs.emit(
					"io.pinf.pio.sync:rpc:response",
					API.JSONRPC.error(
						event.id,
						new API.JSONRPC.JsonRpcError(
							'Error in RPC request handler',
							500
						)
					),
					function (err) {
						if (err) {
							console.error("Error sending RPC error response:", err.stack);
						}
					}
				);
			}
		}, function (err) {
			if (err) {
				console.error("Error adding VFS event handler 'io.pinf.pio.sync:rpc':", err.stack);
			}
		});

		var worker = new VFS_SOCKET_WORKER(vfs);

		var streamRouter = STREAM_ROUTER();

		function hookAuthorizedRoutes () {

			streamRouter.addRoute("/vfs", function (socket, params) {

				logger.info("New /vfs socket channel");

				var transport = new VFS_SOCKET_TRANSPORT(socket, true, "io.pinf.pio.sync-vfs-socket-server-worker");

				worker.connect(transport, function (err, remote) {
					if (err) throw err;

				});
				worker.on("disconnect", function (err) {
					if (err) {
						console.error("Socket disconnect error", err.stack);
					}
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
