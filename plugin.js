

exports.for = function (API) {

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

		var exports = {};

	    exports.runRemoteCommands = function (commands, env) {
	    	if (env) {
	    		for (var name in env) {
                    commands.unshift('export ' + name + '=' + env[name]);
	    		}
                commands.unshift('export VERBOSE=' + (API.VERBOSE?"1":""));
                commands.unshift('export DEBUG=' + (API.DEBUG?"1":""));
	    	}
            commands.unshift('if [ -e ' + resolvedConfig.env.PIO_BIN_DIRPATH + '/activate ]; then . ' + resolvedConfig.env.PIO_BIN_DIRPATH + '/activate; fi');
//			API.console.verbose(("Running remote commands '" + commands.join("; ") + "'.").magenta);
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

	    return exports;
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
						var serviceId = resolvedConfig.services[alias].location;
						var preparedPath = API.PATH.join(API.getTargetPath(), "sync", serviceId);

				    	API.console.verbose("Prepare service '" + serviceId + "' at path '" + preparedPath + "' from source path: " + sourcePath);

						var serviceConfig = resolvedConfig.services[alias] = {
							serviceId: serviceId,
							local: {
								path: preparedPath,
								aspects: {
									source: {
										sourcePath: sourcePath,
										path: preparedPath + "/source",
										addFiles: {
											"package.local.json": {
												"@overlays": {
													"io.pinf.service": "{{env.PIO_SERVICE_HOME}}/{{env.PIO_SERVICE_DESCRIPTOR_PATH}}"
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
													"io.pinf.service": "{{env.PIO_SERVICE_HOME}}/{{env.PIO_SERVICE_DESCRIPTOR_PATH}}"
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
											postdeploy: null
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
						env.PIO_SERVICE_DATA_BASEPATH = resolvedConfig.env.PIO_DATA_DIRPATH + "/" + env.PIO_SERVICE_ID_SAFE;

						env.PIO_SERVICE_LIVE_INSTALL_DIRPATH = env.PIO_SERVICE_HOME + "/live/install";
						env.PIO_SERVICE_LIVE_RUNTIME_DIRPATH = env.PIO_SERVICE_HOME + "/live/runtime";

						// NOTE: This MUST BE IDENTICAL FOR ALL SERVICES and is relative to PIO_SERVICE_HOME!
						env.PIO_SERVICE_DESCRIPTOR_PATH = "package.service.json";

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
								if (pioConfig.on && pioConfig.on.postsync) {
									commands = commands.concat([
										'pushd "' + remote.aspects.source.path + '"',
										'  ' + pioConfig.on.postsync,
										'popd'
									]);
								}
								commands = commands.concat([
									'pushd "' + env.PIO_SERVICE_HOME + '"',
									'  echo "Calling sync/runtime/scripts/postdeploy.sh"',
									'  "sync/runtime/scripts/postdeploy.sh"',
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
								remote.aspects.source.commands.postdeploy = commands;
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

resolvedConfig.t = Date.now();

				return resolvedConfig;
			});
		});
	}

	exports.turn = function (resolvedConfig) {

		var api = makeAPI(resolvedConfig);

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


	    function uploadServices () {

		    function uploadService (alias, serviceConfig) {

			    function prepareService () {

			    	// HACK: Remove this once we check in PGL.
			    	if (API.Q.isPromise(EXPORT)) throw new Error("'EXPORT' should be resolved to an object by now! We should never get here! Time to improve the hack!");

					function prepareAspect (aspect) {
						var paths = serviceConfig.local.aspects[aspect].sourcePath;
						if (!Array.isArray(paths)) {
							paths = [
								paths
							];
						}
						var done = API.Q.resolve();
						paths.forEach(function (path) {
							done = API.Q.when(done, function () {
						    	return EXPORT.export(
						    		path,
						    		serviceConfig.local.aspects[aspect].path,
						    		"snapshot"
						    	);
							});
						});
						return done.then(function () {
							return EXPORT.addFile(
								API.PATH.join(serviceConfig.local.aspects[aspect].path, "package.local.json"),
								JSON.stringify(serviceConfig.local.aspects[aspect].addFiles["package.local.json"], null, 4)
				    		);
				    	});
					}

					function writeServiceConfigs () {
						return API.Q.all(Object.keys(serviceConfig.remote.addFiles).map(function (filename) {
							return API.Q.denodeify(function (callback) {
								return API.FS.outputFile(
									API.PATH.join(serviceConfig.local.path, filename),
									JSON.stringify(serviceConfig.remote.addFiles[filename], null, 4),
					    			"utf8",
					    			callback
					    		);
							})();
						}));

					}

					return API.Q.all([
						prepareAspect("source"),
						prepareAspect("runtime"),
						writeServiceConfigs()
					]).then(function () {
						return FSINDEX.indexAndWriteForm(serviceConfig.local.path, "asis");
					});
			    }


		    	API.console.verbose("Upload service '" + serviceConfig.serviceId + "' from '" + serviceConfig.local.path + "' to sync path: " + serviceConfig.remote.aspects.sync.path);

		    	return prepareService().then(function () {
					return api.uploadFiles(serviceConfig.local.path, serviceConfig.remote.aspects.sync.path);
		    	});
		    }

		    API.console.verbose("Uploading services in parallel:");

		    var deferred = API.Q.defer();
			var throttle = API.Q.Throttle(5);
			throttle.on("error", deferred.reject);
			throttle.on("done", deferred.resolve);
			resolvedConfig.servicesOrder.forEach(function (alias) {
				throttle.when([alias], function(alias) {
					return uploadService(alias, resolvedConfig.services[alias]);
				});
		    });
		    return deferred.promise;
		}

		function postdeployServices () {
		    function postdeployService(alias, serviceConfig) {
		    	API.console.verbose("Trigger postdeploy for service '" + serviceConfig.serviceId + "' at path: " + serviceConfig.remote.aspects.sync.path);
		    	API.console.debug("Commands", serviceConfig.remote.aspects.source.commands.postdeploy);
		    	return api.runRemoteCommands(
					serviceConfig.remote.aspects.source.commands.postdeploy,
					serviceConfig.remote.addFiles["package.service.json"].env
				);
		    }

		    API.console.verbose("Running postdeploy in series:");

		    var done = API.Q.resolve();
		    resolvedConfig.servicesOrder.forEach(function (alias) {
		    	done = API.Q.when(done, function () {
					return postdeployService(alias, resolvedConfig.services[alias]);
		    	});
		    });
		    return done;
		}

	    return ensurePrerequisites().then(function () {
	    	return uploadServices();
	    }).then(function () {
	    	return postdeployServices();
	    });
	}

	return exports;
}
