
const VFS_LOCAL = require("vfs-local");
const NET = require('net');
const VFS_SOCKET_CONSUMER = require('vfs-socket/consumer').Consumer;
const VFS_SOCKET_TRANSPORT = require('vfs-socket/worker').smith.Transport;
const EVENTS = require("events");

const MUX_DEMUX = require('mux-demux/msgpack');


require('org.pinf.genesis.lib').forModule(require, module, function (API, exports) {

	var config = API.config["vfs-socket-server"];

	var privateKey = API.FS.readFileSync(config.privateKeyPath);

	var remoteVFS = null;

	exports.connect = function (onEveryNewConnection) {
		if (remoteVFS) {
			if (API.Q.isPromise(remoteVFS)) {
				return remoteVFS;
			}
			return API.Q.resolve(remoteVFS);
		}

		var host = config.bind;

		API.console.verbose("Init re-connecting connection to VFS at: " + host + ":" + config.port);

		var deferred = API.Q.defer();
		remoteVFS = deferred.promise;

		function connectAndReconnect () {

			API.console.debug("Connecting to '" + host + ":" + config.port + "'.");

			var statusEvents = new EVENTS.EventEmitter();

			function reconnect (reason, msg) {
				API.console.debug("schedule reconnect", reason, msg);
				if (reconnect.reconnecting) {
					API.console.debug("skip schedule reconnect: already scheduled or reconnecting");
					return;
				}
				API.console.verbose("Error '" + msg + "' from '" + reason + "' while connecting to '" + host + ":" + config.port + "'. Waiting a bit and trying again.");
				reconnect.reconnecting = true;
				if (remoteVFS) {
					if (API.Q.isPromise(remoteVFS)) {
						if (API.Q.isPending(remoteVFS)) {
							deferred.resolve(null);
						}
					}
					statusEvents.emit("destroy");
					remoteVFS = null;
				}
				setTimeout(function () {
					API.console.debug("trigger reconnect");
					connectAndReconnect();
				}, 1000);
			}

			var socket = NET.connect(config.port, host);
			socket.on("error", function (err) {
				reconnect("socket error", err.message);
			});
			socket.on("close", function (had_error) {
				reconnect("socket close", had_error);
			});
			socket.on("connect", function () {

				var mdm = MUX_DEMUX({
					error: false
				});

				function mapRoutesAfterAuthorization () {

					var transport = new VFS_SOCKET_TRANSPORT(
						mdm.createStream("/vfs"),
						!!API.DEBUG,
						"io.pinf.pio.sync-vfs-socket-client-consumer"
					);

					var consumer = new VFS_SOCKET_CONSUMER();
					consumer.on("error", function (err) {
						if (err.code === "ENOTCONNECTED") {
							reconnect("consumer error", err.message);
							return;
						}
	console.log("Non-fatal VFS error?", err.stack);
	//process.exit(1);
					});
					consumer.on("disconnect", function (err) {
						reconnect("consumer disconnect", (err && err.message) || "");
					});
					consumer.connect(
						transport,
						function (err, vfs) {
							if (err) {
								console.error(err.stack);
								deferred.resolve(null);
								return;
							}
							API.console.verbose("Connected to remote VFS.");
							remoteVFS = vfs;
							if (onEveryNewConnection) {
								try {
									onEveryNewConnection(remoteVFS, statusEvents);
								} catch (err) {
									console.error("Error calling 'onEveryNewConnection' callback. You need to handle your errors and not throw!", err.stack);
									throw err;
								}
							}
							deferred.resolve(remoteVFS);
						}
					);
				}

				var publicKey = null;

				// TODO: Use 'publicKey' to encrypt all outgoing data.
				// TODO: Use 'privateKey' to decrypt all incoming data.
				socket.pipe(mdm).pipe(socket)

				var auth = mdm.createStream("/auth");
				auth.on("data", function (authResponse) {
					if (authResponse === "FAILED") {
						deferred.reject(new Error("Auth failure!"));
						return;
					}

					// We are authorized.
					publicKey = authResponse;
					mapRoutesAfterAuthorization();
				});
				auth.write(API.JWT.sign({
					identityInfo: "TODO"
				}, privateKey, {
					algorithm: 'RS256'
				}));
			});
		}

		connectAndReconnect();

		return deferred.promise.fail(function (err) {
			console.error("ERROR", err.stack);
			throw err;
		});
	}


});
