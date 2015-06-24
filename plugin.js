
// If we are being called directly from node as the first script
// we boot the vfs-socket-server by default.
// TODO: Make what to boot configurable via the program descriptor.
if (require.main === module) {

	require("./api/vfs-socket-server").for(null);

} else {

	exports.for = function (API) {

		const VFS_LINT = require("vfs-lint");

		const SSH = require("./ssh").for(API);
		const RSYNC = require("./rsync").for(API);

		// TODO: Wait in 'genesis.pinf.org' until all PGL init promises are resolved before
		//       calling resolve/turn/spin methods.
		// HACK: We assume the promises are resolved by the time we use them here.
		var EXPORT = require("org.sourcemint.genesis.lib/lib/export").for(API).then(function (api) {
			EXPORT = api;
		});
		var FSINDEX = require("org.sourcemint.genesis.lib/lib/fsindex").for(API).then(function (api) {
			FSINDEX = api;
		});

		// TODO: This implementation should come from the VM plugin and we just call it here.
		function makeAPI (resolvedConfig) {

			if (makeAPI.exports) {
				return API.Q.resolve(makeAPI.exports);
			}

			var exports = makeAPI.exports = {};

			var vfs = null;

		    exports.runRemoteCommands = function (commands, _env, forceSSH) {

		    	var env = {};
		    	for (var name in _env) {
		    		env[name] = _env[name];
		    	}
		    	env.VERBOSE = (API.VERBOSE?"1":"");
		    	env.DEBUG = (API.DEBUG?"1":"");

				if (
					forceSSH !== true &&
					vfs &&
					// Only use vfs socket connection if not syncing the sunc service itself.
					// The sync service must be sycned via SSH as the connection would drop
					// when the remote service is restarted.
					env.PIO_SERVICE_ID_SAFE !== "io-pinf-pio-sync"
				) {
					return API.Q.denodeify(function (callback) {

			            commands.unshift('if [ -e ' + resolvedConfig.env.PIO_BIN_DIRPATH + '/activate ]; then . ' + resolvedConfig.env.PIO_BIN_DIRPATH + '/activate; fi');

		                API.console.verbose(("Calling commands via VFS '" + commands.join("; ") + "'").magenta);

						vfs.spawn("/bin/bash", {
							args: [
								"-e",
								"-s"
							],
							stdoutEncoding: "utf8",
							env: env || {}
						}, function (err, meta) {
							if (err) {
								console.error("Error while calling remote server via VFS. Tryign SSH instead. Error was:", err.stack);
								return exports.runRemoteCommands(commands, _env, true).then(function () {
									return callback(null);
								}, callback);
							}
							var child = meta.process;
							var stderr = [];
							child.stderr.on("data", function (data) {
								if (API.VERBOSE) {
			                        process.stderr.write(data);
			                    }
			                    stderr.push(data.toString());
							});
							var stdout = [];
							child.stdout.on("data", function (data) {
								if (API.VERBOSE) {
			                        process.stdout.write(data);
			                    }
			                    stdout.push(data.toString());
							});
							child.stdout.on("end", function () {
			                    return callback(null, {
			                        code: 0,
			                        stdout: stdout.join(""),
			                        stderr: stderr.join("")
			                    });
							});
							commands.forEach(function (command) {
								child.stdin.write(command + "\n");
							});
							child.stdin.end();
						});
					})();
				}

		    	if (env) {
		    		for (var name in env) {
	                    commands.unshift('export ' + name + '=' + env[name]);
		    		}
		    	}
	            commands.unshift('if [ -e ' + resolvedConfig.env.PIO_BIN_DIRPATH + '/activate ]; then . ' + resolvedConfig.env.PIO_BIN_DIRPATH + '/activate; fi');

	            return SSH.runRemoteCommands({
					targetUser: resolvedConfig.ssh.user,
		            targetHostname: resolvedConfig.ssh.host,
		            commands: commands,
		            workingDirectory: "~/",
		            keyPath: resolvedConfig.ssh.privateKeyPath,
		            timeout: 60 * 30	// 30 minutes
	            });
		    }

		    exports.uploadFiles = function (sourcePath, targetPath) {

		    	// TODO: Use VFS connection to upload files if available.

		    	API.console.debug("Do upload files from '" + sourcePath + "' to '" + targetPath);

				return API.Q.denodeify(RSYNC.sync)({
		            sourcePath: sourcePath,
		            targetPath: targetPath,
					targetUser: resolvedConfig.ssh.user,
		            targetHostname: resolvedConfig.ssh.host,
		            keyPath: resolvedConfig.ssh.privateKeyPath,
		            excludeFromPath: API.FS.existsSync(API.PATH.join(sourcePath, ".syncignore")) ? API.PATH.join(sourcePath, ".syncignore") : null,
		            delete: true
		        });
		    }

		    exports.rpc = function (method, args) {
		    	if (!vfs) {
		    		return null;
		    	}
		    	return vfs.rpc("VFS_RPC_API", method, args);
		    }

		    function initVFSConnection () {
		    	if (initVFSConnection.status) {
		    		return API.Q.resolve(initVFSConnection.status);
		    	}
		    	initVFSConnection.status = "pending";
				return API.Q.when(require("./api/vfs-socket-client").for({
					args: {
						config: {
							"vfs-socket-server": resolvedConfig["vfs-socket-server"]
						}
					}
				})).then(function (api) {
					return api.connect(function onEveryNewConnection (remoteVFS, statusEvents) {
						statusEvents.on("destroy", function () {
							vfs = null;
							initVFSConnection.status = "pending";
						});
						vfs = VFS_LINT(remoteVFS);
				    	initVFSConnection.status = "connected";
					});
				}).fail(function (err) {
					initVFSConnection.status = null;
					console.error(err.stack);
					throw err;
				});
		    }

			return initVFSConnection().then(function () {
			    return exports;
			});
		}

		var exports = {};

		exports.resolve = function (resolver, config, previousResolvedConfig) {

			return resolver({}).then(function (resolvedConfig) {

				if (resolvedConfig.ssh.uri) {
					// TODO: Support more formats.
					var uriParts = resolvedConfig.ssh.uri.split("@");
					resolvedConfig.ssh.user = uriParts[0];
					resolvedConfig.ssh.host = uriParts[1];
				}
				if (!resolvedConfig.ssh.host) {
					resolvedConfig.ssh.host = resolvedConfig.ssh.ip;
				}

				function loadAdapter () {
					return require(resolvedConfig.adapters.os).for(API);
				}

				return loadAdapter().then(function (adapter) {

	        		adapter.resolveSystemENV(resolvedConfig.env);

	        		if (!resolvedConfig.remote) {
	        			resolvedConfig.remote = {};
	        		}
	        		if (!resolvedConfig.remote.commands) {
	        			resolvedConfig.remote.commands = {};
	        		}
	        		resolvedConfig.remote.commands.prerequisite = adapter.generateSystemPrerequisiteCommands({
	        			sshUser: resolvedConfig.ssh.user,
	        			env: resolvedConfig.env
	        		});

					function resolveServices () {

						function prepareService (alias) {

							// TODO: Support more advanced locators.
							var sourcePath = API.PATH.dirname(require.resolve(resolvedConfig.services[alias].location + "/package.json"));
							var serviceId = alias;
							var preparedPath = API.PATH.join(API.getTargetPath(), "sync", serviceId);

					    	API.console.verbose("Prepare service '" + serviceId + "' at path '" + preparedPath + "' from source path: " + sourcePath);

							var serviceConfig = resolvedConfig.services[alias] = {
								serviceId: serviceId,
								local: {
									path: preparedPath,
									hashes: {
										".smg.form.json": null
									},
									aspects: {
										source: {
											sourcePath: sourcePath,
											path: preparedPath + "/source",
											addFiles: {
												"package.local.json": {
													"@overlays": {
														"io.pinf.service": "../package.service.json"
													}
												}
											}
										},
										runtime: {
											sourcePath: null,
											path: preparedPath + "/runtime",
											addFiles: {
												"package.local.json": {
													"@overlays": {
														"io.pinf.service": "../package.service.json"
													}
												}
											}
										}
									}
								},
								remote: {
									path: null,
									aspects: {
										sync: {
											path: null
										},
										source: {
											path: null,
											commands: {
												prerequisite: null,
												postsync: null
											}
										},
										runtime: {
											path: null
										}
									},
									addFiles: {
										// Add the *Package Descriptor* that customizes the package
										// to act as one *Service* in a *System* of many.
										"package.service.json": {
											"env": {},
											"config": resolvedConfig.services[alias].config || {}
										},
										"program.json": {
											"@extends": {
												"serviceConfig": "./package.service.json"
											},
											"boot": resolvedConfig.services[alias].boot || {}
										}
									}
								}
							}

							var env = serviceConfig.remote.addFiles["package.service.json"].env;
							for (var name in resolvedConfig.env) {
								env[name] = resolvedConfig.env[name];
							}
							env.PIO_SERVICE_HOME = resolvedConfig.env.PIO_SERVICES_DIRPATH + "/" + serviceConfig.serviceId;
							env.PIO_SERVICE_ID = serviceConfig.serviceId;
							env.PIO_SERVICE_ID_SAFE = env.PIO_SERVICE_ID.replace(/\./g, "-");
							env.PIO_SERVICE_LOG_BASEPATH = resolvedConfig.env.PIO_LOG_DIRPATH + "/" + env.PIO_SERVICE_ID_SAFE;
							env.PIO_SERVICE_RUN_BASEPATH = resolvedConfig.env.PIO_RUN_DIRPATH + "/" + env.PIO_SERVICE_ID_SAFE;
							env.PIO_SERVICE_CACHE_BASEPATH = resolvedConfig.env.PIO_CACHE_DIRPATH + "/" + env.PIO_SERVICE_ID_SAFE;
							env.PIO_SERVICE_DATA_BASEPATH = resolvedConfig.env.PIO_DATA_DIRPATH + "/" + env.PIO_SERVICE_ID_SAFE;

							env.PIO_SERVICE_ASPECT = "live";
							env.PIO_SERVICE_LIVE_DIRPATH = env.PIO_SERVICE_HOME + "/live";
							env.PIO_SERVICE_LIVE_INSTALL_DIRPATH = env.PIO_SERVICE_LIVE_DIRPATH + "/install";
							env.PIO_SERVICE_LIVE_RUNTIME_DIRPATH = env.PIO_SERVICE_LIVE_DIRPATH + "/runtime";
							env.PIO_SERVICE_ACTIVATE_FILEPATH = env.PIO_SERVICE_ACTIVATE_FILEPATH || (env.PIO_SERVICE_LIVE_DIRPATH + "/activate");

							// NOTE: This MUST BE IDENTICAL FOR ALL SERVICES and is relative to `PIO_SERVICE_HOME/<aspect>`!
							env.PIO_SERVICE_DESCRIPTOR_PATH = "package.service.json";


							env.PINF_PROGRAM_PATH = env.PIO_SERVICE_LIVE_DIRPATH + "/program.json";


							// Copy the previous hash so we can compare it below.
							// TODO: We should already be computing and comparing the has here
							//       as "preparing" the service should not be necessary as
							//       files are synced in realtime.
							if (
								previousResolvedConfig &&
								previousResolvedConfig.services &&
								previousResolvedConfig.services[alias] &&
								previousResolvedConfig.services[alias].local &&
								previousResolvedConfig.services[alias].local.hashes
							) {
								serviceConfig.local.hashes = previousResolvedConfig.services[alias].local.hashes;
							}


							function resolveRemote () {

								var remote = serviceConfig.remote;

								remote.path = env.PIO_SERVICE_HOME;

								remote.aspects.sync.path = remote.path + "/sync";
								remote.aspects.source.path = remote.aspects.sync.path + "/source";
								remote.aspects.runtime.path = remote.aspects.sync.path + "/runtime";

								remote.aspects.source.commands.prerequisite = adapter.generateServicePrerequisiteCommands({
									env: env,
									remote: remote
								});

								remote.addFiles["program.json"].boot.package = "./install/package.json";

								return API.Q.nbind(API.PACKAGE.fromFile, API.PACKAGE)(API.PATH.join(serviceConfig.local.aspects.source.sourcePath, "package.json"), {
									// We use the ENV variables of the REMOTE environment.
									env: env
								}).then(function (descriptor) {

									var pioConfig = descriptor.configForLocator(API.LOCATOR.fromConfigId("pio.pinf.io/0"));
									if (remote.addFiles["package.service.json"].config["pio.pinf.io/0"]) {
										pioConfig = API.DEEPMERGE(pioConfig, remote.addFiles["package.service.json"].config["pio.pinf.io/0"]);
									}
									remote["pio.pinf.io/0"] = pioConfig;

									API.console.debug("pioConfig", pioConfig);
									var commands = [];
									for (var name in env) {
										commands.push('export ' + name + '=' + env[name]);
									}
									if (pioConfig.on && pioConfig.on.prepostsync) {
										commands = commands.concat([
											'pushd "' + remote.aspects.source.path + '"',
											'  ' + pioConfig.on.prepostsync,
											'popd'
										]);
									}
									commands = commands.concat([
										'pushd "' + env.PIO_SERVICE_HOME + '"',
										'  echo "Calling sync/runtime/scripts/postsync.sh"',
										'  "sync/runtime/scripts/postsync.sh"',
										'popd'
									]);
									if (pioConfig.on && pioConfig.on.postactivate) {
										commands.push('pushd "' + env.PIO_SERVICE_LIVE_INSTALL_DIRPATH + '"');
										if (Array.isArray(pioConfig.on.postactivate)) {
											commands = commands.concat(pioConfig.on.postactivate);
										} else {
											commands.push(pioConfig.on.postactivate);
										}
										commands.push('popd');
									}
									remote.aspects.source.commands.postsync = commands;
								});
							}

							return resolveRemote().then(function () {

								return adapter.resolveServiceRuntimeTemplatePaths({
									remote: serviceConfig.remote,
									local: serviceConfig.local
								}).then(function (runtimeTemplatePaths) {

									serviceConfig.local.aspects.runtime.sourcePath = runtimeTemplatePaths;

								});
							});
					    }

					    resolvedConfig.servicesOrder = API.DESCRIPTOR.sortObjByDepends(resolvedConfig.services);
					    API.console.verbose("Sorted services:", resolvedConfig.servicesOrder);
					    return API.Q.all(resolvedConfig.servicesOrder.map(function (alias) {
					    	return prepareService(alias);
					    }));
					}

					return resolveServices();

				}).then(function () {

//	resolvedConfig.t = Date.now();

		            console.log("Remote VM: " + [
		            	'ssh',
		                '-o', 'ConnectTimeout=5',
		                '-o', 'ConnectionAttempts=1',
		                '-o', 'UserKnownHostsFile=/dev/null',
		                '-o', 'StrictHostKeyChecking=no',
		                '-o', 'UserKnownHostsFile=/dev/null',
		                '-o', 'IdentityFile=' + resolvedConfig.ssh.privateKeyPath,
		                resolvedConfig.ssh.user + '@' + resolvedConfig.ssh.host
		            ].join(" ").magenta);

					return resolvedConfig;
				});
			});
		}

		exports.turn = function (resolvedConfig, helpers) {

			return makeAPI(resolvedConfig).then(function (api) {

				function ensurePrerequisites (repeat) {

		            function ensureGlobalPrerequisites() {
		                if (repeat) {
		                    return API.Q.reject("Could not provision prerequisites on system!");
		                }
		                API.console.verbose("Ensuring global prerequisites");
		                return api.runRemoteCommands(resolvedConfig.remote.commands.prerequisite).then(function() {
		                    return ensurePrerequisites(true);
		                });
		            }

		            var commands = [
		                'if [ ! -e "' + resolvedConfig.env.PIO_BIN_DIRPATH + '/activate" ]; then',
		                '  echo "[pio:trigger-ensure-prerequisites]";',
		                '  exit 0;',
		                'fi',
		            ];

		            resolvedConfig.servicesOrder.forEach(function (alias) {
		            	commands = commands.concat(resolvedConfig.services[alias].remote.aspects.source.commands.prerequisite);
				    });

		            return api.runRemoteCommands(commands).then(function(response) {
		                if (/\[pio:trigger-ensure-prerequisites\]/.test(response.stdout)) {
		                    return ensureGlobalPrerequisites();
		                }
		            });
		        }

		        var uploadedServices = {};

			    function uploadServices () {

				    function uploadService (alias, serviceConfig) {

					    function prepareService () {

					    	// HACK: Remove this once we check in PGL.
					    	if (API.Q.isPromise(EXPORT)) throw new Error("'EXPORT' should be resolved to an object by now! We should never get here! Time to improve the hack!");

							function prepareAspect (aspect) {

						    	API.console.debug("Prepare '" + aspect + "' aspect for service '" + serviceConfig.serviceId + "'");

								var paths = serviceConfig.local.aspects[aspect].sourcePath;
								if (!Array.isArray(paths)) {
									paths = [
										paths
									];
								}
								var done = API.Q.resolve();
								paths.forEach(function (path) {
									done = API.Q.when(done, function () {

								    	API.console.debug("Export path '" + path + "' for aspect '" + aspect + "' for service '" + serviceConfig.serviceId + "'");

								    	return EXPORT.export(
								    		path,
								    		serviceConfig.local.aspects[aspect].path,
								    		"snapshot"
								    	).then(function () {
									    	API.console.debug("Export path '" + path + "' for aspect '" + aspect + "' for service '" + serviceConfig.serviceId + "' done");
								    	});
									});
								});
								return done.then(function () {

							    	API.console.debug("Write local overlays for aspect '" + aspect + "' for service '" + serviceConfig.serviceId + "'");

									return EXPORT.addOrReplaceFile(
										API.PATH.join(serviceConfig.local.aspects[aspect].path, "package.local.json"),
										JSON.stringify(serviceConfig.local.aspects[aspect].addFiles["package.local.json"], null, 4)
						    		).then(function () {

								    	API.console.debug("Write local overlays for aspect '" + aspect + "' for service '" + serviceConfig.serviceId + "' done");
						    		});
						    	}).then(function () {
							    	API.console.debug("Prepare '" + aspect + "' aspect for service '" + serviceConfig.serviceId + "' done");
								});;
							}

							function writeServiceConfigs () {

						    	API.console.debug("Write service configs for service '" + serviceConfig.serviceId + "'");

								return API.Q.all(Object.keys(serviceConfig.remote.addFiles).map(function (filename) {
									return API.Q.denodeify(function (callback) {

								    	API.console.debug("Output file '" + API.PATH.join(serviceConfig.local.path, filename) + "' for service '" + serviceConfig.serviceId + "'");

										return API.FS.outputFile(
											API.PATH.join(serviceConfig.local.path, filename),
											JSON.stringify(serviceConfig.remote.addFiles[filename], null, 4),
							    			"utf8",
							    			callback
							    		);
									})();
								})).fail(function (err) {
									console.error(err.stack);
									throw err;
								}).then(function () {
							    	API.console.debug("Write service configs for service '" + serviceConfig.serviceId + "' done");
								});
							}

/*
							return prepareAspect("source").then(function () {
								return prepareAspect("runtime").then(function () {
									return writeServiceConfigs();
								});
							}).then(function () {
*/

							return API.Q.all([
								prepareAspect("source"),
								prepareAspect("runtime"),
								writeServiceConfigs()
							]).then(function () {

						    	API.console.debug("Run FS index for service '" + serviceConfig.serviceId + "'");

								return FSINDEX.indexAndWriteForm(serviceConfig.local.path, "asis").then(function () {

							    	API.console.debug("FS index run for service '" + serviceConfig.serviceId + "' done");

									return API.Q.denodeify(function (callback) {

										var smgFormDescriptorPath = API.PATH.join(serviceConfig.local.path, ".smg.form.json");
										return API.FS.readFile(smgFormDescriptorPath, "utf8", function (err, data) {
											if (err) return callback(err);

											var newHash = API.CRYPTO.createHash("sha256").update(data).digest("hex");

											// If the hash has changed from the previous one we
											// record that fact so a postsync can be triggered
											// that skips all caches (a previous cache entry may be found
											// if a file size for an entry in '.smg.form.json' comes
											// to a previous value but the file in fact contains
											// different data.
											// NOTE: This is a limitation of only checking for filesizes
											//       instead of also taking modification times into account.

											if (newHash !== serviceConfig.local.hashes[".smg.form.json"]) {
												serviceConfig.local.hashes[".smg.form.json"] = newHash;

												// We trigger an upload just because the value has changed.
												if (!uploadedServices[alias]) {
													uploadedServices[alias] = {};
												}
												uploadedServices[alias]["PIO_SKIP_SYNC_CHECKSUM_CACHE"] = "1";
												uploadedServices[alias]["PIO_FORCE_SYNC_UPLOAD"] = "1";

												return helpers.saveResolvedConfig().then(function () {
													return callback(null);
												}, callback);
											}

											return callback(null);
										});
									})();
								});
							});
					    }

					    function checkIfNeedToUpload () {

					    	if (
					    		uploadedServices[alias] &&
					    		uploadedServices[alias]["PIO_FORCE_SYNC_UPLOAD"]
					    	) {
								API.console.verbose("Force upload due to 'PIO_FORCE_SYNC_UPLOAD'.");
					    		return API.Q.resolve(true);
					    	}

							return makeAPI(resolvedConfig).then(function (api) {

								var rpc = api.rpc("getServiceSyncHash", {
									serviceId: serviceConfig.remote.addFiles["package.service.json"].env.PIO_SERVICE_ID
								});
								if (!rpc) {
									API.console.verbose("No remote 'vfs' connection available. Skipping remote service sync hash fetch.");
									// TODO: Check against local file mtime cache to see if anything changed.
									// TODO: Use SSH connection to chec if something has changed.
									return true;
								}
								return rpc.then(function (args) {
									if (
										!args ||
										!args.hash
									) {
										// Upload in the hope of getting back a hash next time.
										return true;
									}
									if (args.hash !== serviceConfig.local.hashes[".smg.form.json"]) {
										// Changes found between local and remote.
										return true;
									}
									// No changes found.
									return false;									
								});
							});
					    }

				    	API.console.verbose("Check if need to upload service '" + serviceConfig.serviceId + "' from '" + serviceConfig.local.path + "' to sync path: " + serviceConfig.remote.aspects.sync.path);

				    	return prepareService().then(function () {

					    	API.console.debug("Service '" + serviceConfig.serviceId + "' prepared");

				    		return checkIfNeedToUpload().then(function (needToUpload) {
				    			if (!needToUpload) {
							    	API.console.verbose("Skip upload as no changes detected.");
							    	return;
				    			}

				    			if (!uploadedServices[alias]) {
				    				uploadedServices[alias] = {};
				    			}

								return api.uploadFiles(serviceConfig.local.path, serviceConfig.remote.aspects.sync.path);
				    		});
				    	});
				    }

				    API.console.verbose("Uploading services in parallel:");

				    var deferred = API.Q.defer();
					var throttle = API.Q.Throttle(5);
//					var throttle = API.Q.Throttle(1);
					throttle.on("error", deferred.reject);
					throttle.on("done", deferred.resolve);
					resolvedConfig.servicesOrder.forEach(function (alias) {
						throttle.when([alias], function(alias) {
							return uploadService(alias, resolvedConfig.services[alias]);
						});
				    });
				    return deferred.promise;
				}

				function postsyncServices () {

				    function postsyncService(alias, serviceConfig, extraEnv) {
				    	var env = {};
				    	for (var name in serviceConfig.remote.addFiles["package.service.json"].env) {
				    		env[name] = serviceConfig.remote.addFiles["package.service.json"].env[name];
				    	}
				    	for (var name in extraEnv) {
				    		env[name] = extraEnv[name];
				    	}
				    	API.console.verbose("Trigger postsync for service '" + serviceConfig.serviceId + "' at path: " + serviceConfig.remote.aspects.sync.path);
				    	API.console.debug("Commands", serviceConfig.remote.aspects.source.commands.postsync);
				    	return api.runRemoteCommands(
							serviceConfig.remote.aspects.source.commands.postsync,
							env
						);
				    }

				    API.console.verbose("Running postsync in series:");

				    var done = API.Q.resolve();
				    resolvedConfig.servicesOrder.forEach(function (alias) {
				    	if (uploadedServices[alias]) {
					    	done = API.Q.when(done, function () {
								return postsyncService(alias, resolvedConfig.services[alias], uploadedServices[alias]);
					    	});
					    }
				    });
				    return done;
				}

			    return ensurePrerequisites().then(function () {
			    	return uploadServices();
			    }).then(function () {
			    	return postsyncServices();
			    });
			});			    
		}

		return exports;
	}
}