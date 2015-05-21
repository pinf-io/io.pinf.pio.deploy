
exports.for = function (API) {

	const SSH = require("./ssh").for(API);
	const RSYNC = require("./rsync").for(API);
	var EXPORT = require("org.sourcemint.genesis.lib/lib/export").for(API).then(function (api) {
		EXPORT = api;
	});
	// TODO: Wait in 'genesis.pinf.org' until all PGL init promises are resolved before
	//       calling resolve/turn/spin methods.
	// HACK: We assume the promises are resolved by the time we use them here.


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

        	if (!resolvedConfig.env) {
        		resolvedConfig.env = {};
        	}
        	resolvedConfig.env.PIO_HOME = resolvedConfig.env.PIO_HOME || "$HOME/io.pinf";
        	resolvedConfig.env.PIO_BIN_DIRPATH = resolvedConfig.env.PIO_BIN_DIRPATH || (resolvedConfig.env.PIO_HOME + "/bin");
        	resolvedConfig.env.PIO_LOG_DIRPATH = resolvedConfig.env.PIO_LOG_DIRPATH || (resolvedConfig.env.PIO_HOME + "/log");
        	resolvedConfig.env.PIO_RUN_DIRPATH = resolvedConfig.env.PIO_RUN_DIRPATH || (resolvedConfig.env.PIO_HOME + "/run");
        	resolvedConfig.env.PIO_DATA_DIRPATH = resolvedConfig.env.PIO_DATA_DIRPATH || (resolvedConfig.env.PIO_HOME + "/data");

        	resolvedConfig.env.PIO_SERVICES_DIRPATH = resolvedConfig.env.PIO_SERVICES_DIRPATH || (resolvedConfig.env.PIO_HOME + "/services");


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
											"@extends": {
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
											"@extends": {
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
									path: null
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
					env.PIO_SERVICE_ID_SAFE = serviceConfig.serviceId.replace(/\./g, "-");
					env.PIO_SERVICE_LOG_BASEPATH = resolvedConfig.env.PIO_LOG_DIRPATH + "/" + env.PIO_SERVICE_ID_SAFE;
					env.PIO_SERVICE_RUN_BASEPATH = resolvedConfig.env.PIO_RUN_DIRPATH + "/" + env.PIO_SERVICE_ID_SAFE;
					env.PIO_SERVICE_DATA_BASEPATH = resolvedConfig.env.PIO_DATA_DIRPATH + "/" + env.PIO_SERVICE_ID_SAFE;

					// NOTE: This MUST BE IDENTICAL FOR ALL SERVICES and is relative to PIO_SERVICE_HOME!
					env.PIO_SERVICE_DESCRIPTOR_PATH = "package.service.json";

					function resolveRuntimePath () {
						var adapterBasePath = API.PATH.dirname(require.resolve(resolvedConfig.adapters.os + "/package.json"));

						// TODO: Look at descriptor from adapter package to find template path
						var templatePath = "runtimes";

						// TODO: Determine template type by auto-scanning or declaration.
						var templateType = "nodejs-server";

						var runtimeBasePath = API.PATH.join(adapterBasePath, templatePath, templateType);

						return API.Q.resolve(runtimeBasePath);
					}

					function resolveRemote () {

						var remote = serviceConfig.remote;

						remote.path = env.PIO_SERVICES_DIRPATH + "/" + serviceConfig.serviceId;

						remote.aspects.sync.path = remote.path + "/sync";
						remote.aspects.source.path = remote.aspects.sync.path + "/source";
						remote.aspects.runtime.path = remote.aspects.sync.path + "/runtime";

						return API.Q.nbind(API.PACKAGE.fromFile, API.PACKAGE)(API.PATH.join(serviceConfig.local.aspects.source.path, "package.json"), {
							// We use the ENV variables of the REMOTE environment.
							env: env
						}).then(function (descriptor) {

							var pioConfig = descriptor.configForLocator(API.LOCATOR.fromConfigId("pio.pinf.io/0"));
							if (remote.addFiles["package.service.json"].config["pio.pinf.io/0"]) {
								pioConfig = API.DEEPMERGE(pioConfig, remote.addFiles["package.service.json"].config["pio.pinf.io/0"]);
							}

							function normalize (pioConfig) {
								// TODO: This should already be normalized by 'configForLocator'.
								if (!pioConfig.on) pioConfig.on = {};
								if (!pioConfig.on.postdeploy) {
									pioConfig.on.postdeploy = "io-pinf-pio-postdeploy";
								}
								if (/^\./.test(pioConfig.on.postdeploy)) {
									pioConfig.on.postdeploy = remote.aspects.source.path + "/" + pioConfig.on.postdeploy;
								}
								return pioConfig;
							}
							pioConfig = normalize(JSON.parse(JSON.stringify(pioConfig || {})));

							var commands = remote.aspects.source.commands = [
								'cd ' + remote.aspects.source.path
							];
							for (var name in env) {
								commands.push('export ' + name + '=' + env[name]);
							}
							commands.push(pioConfig.on.postdeploy);
						});
					}

					return resolveRuntimePath().then(function (runtimeSourcePath) {

						serviceConfig.local.aspects.runtime.sourcePath = runtimeSourcePath;

					}).then(function () {
						return resolveRemote();
					});
			    }

			    resolvedConfig.servicesOrder = API.DESCRIPTOR.sortObjByDepends(resolvedConfig.services);
			    API.console.verbose("Sorted services:", resolvedConfig.servicesOrder);
			    return API.Q.all(resolvedConfig.servicesOrder.map(function (alias) {
			    	return prepareService(alias);
			    }));
			}

			return resolveServices().then(function () {

resolvedConfig.t = Date.now();

				return resolvedConfig;
			});	           
		});
	}

	exports.turn = function (resolvedConfig) {

console.log("TURN pio.deploy", resolvedConfig);

		var api = makeAPI(resolvedConfig);

	    function uploadService (alias, serviceConfig) {

			function ensurePrerequisites (repeat) {
            	/*
            	// Use when installing globally in say '/opt/' using username other than root.
                function ensureGlobalPrerequisites() {
                    if (repeat) {
                        return API.Q.reject("Could not provision prerequisites on system!");
                    }
                    API.console.verbose("Ensuring global prerequisites");
                    return api.runRemoteCommands([
                        // Make sure default install directory exists and is writable by our user.
                        'if [ ! -d "' + resolvedConfig.env.PIO_HOME + '" ]; then sudo mkdir -p "' + resolvedConfig.env.PIO_HOME + '"; fi',
                        "sudo chown -f " + resolvedConfig.ssh.user + ":" + resolvedConfig.ssh.user + " " + resolvedConfig.env.PIO_HOME,
                        // Make sure some default directories exist
                        'if [ ! -d "' + resolvedConfig.env.PIO_HOME + '/bin" ]; then mkdir "' + resolvedConfig.env.PIO_HOME + '/bin"; fi',
                        'if [ ! -d "' + resolvedConfig.env.PIO_HOME + '/cache" ]; then mkdir "' + resolvedConfig.env.PIO_HOME + '/cache"; fi',
                        'if [ ! -d "' + resolvedConfig.env.PIO_HOME + '/data" ]; then mkdir "' + resolvedConfig.env.PIO_HOME + '/data"; fi',
                        'if [ ! -d "' + resolvedConfig.env.PIO_HOME + '/tmp" ]; then mkdir "' + resolvedConfig.env.PIO_HOME + '/tmp"; fi',
                        'if [ ! -d "' + resolvedConfig.env.PIO_HOME + '/log" ]; then mkdir "' + resolvedConfig.env.PIO_HOME + '/log"; fi',
                        'if [ ! -d "' + resolvedConfig.env.PIO_HOME + '/run" ]; then mkdir "' + resolvedConfig.env.PIO_HOME + '/run"; fi',
                        'if [ ! -d "' + resolvedConfig.env.PIO_HOME + '/services" ]; then mkdir "' + resolvedConfig.env.PIO_HOME + '/services"; fi',
                        // Put `<prefix>/bin` onto system-wide PATH.
                        'if [ ! -f "/etc/profile.d/io.pinf.sh" ]; then',
                        '  sudo touch "/etc/profile.d/io.pinf.sh"',
                        "  sudo chown -f " + resolvedConfig.ssh.user + ":" + resolvedConfig.ssh.user + " /etc/profile.d/io.pinf.sh",
                        // TODO: Get `pio._config.env.PATH` from `state["pio"].env`.
                        '  echo "source \"' + resolvedConfig.env.PIO_HOME + '/bin/activate\"" > /etc/profile.d/io.pinf.sh',
                        '  sudo chown root:root "/etc/profile.d/io.pinf.sh"',
                        'fi',
                        'if [ ! -f "' + resolvedConfig.env.PIO_HOME + '/bin/activate" ]; then',
                        '  echo "#!/bin/sh -e\nexport PATH=' + resolvedConfig.env.PIO_HOME + '/bin:$PATH\n" > ' + resolvedConfig.env.PIO_HOME + '/bin/activate',
                        "  sudo chown -f " + resolvedConfig.ssh.user + ":" + resolvedConfig.ssh.user + " " + resolvedConfig.env.PIO_HOME + '/bin/activate',
                        'fi',
                        "sudo chown -f " + resolvedConfig.ssh.user + ":" + resolvedConfig.ssh.user + " " + resolvedConfig.env.PIO_HOME + '/*',
                        // NOTE: When deploying as root we need to give the group write access to allow other processes to access the files.
                        // TODO: Narrow down file access by using different users and groups for different services depending on their relationships.
                        "sudo chmod -Rf g+wx " + resolvedConfig.env.PIO_HOME
                    ], "~/").then(function() {
                        return ensurePrerequisites(true);
                    });
                }
                */
                function ensureGlobalPrerequisites() {
                    if (repeat) {
                        return API.Q.reject("Could not provision prerequisites on system!");
                    }
                    API.console.verbose("Ensuring global prerequisites");
                    return api.runRemoteCommands([
                        // Make sure default install directory exists
                        'if [ ! -d ' + resolvedConfig.env.PIO_HOME + ' ]; then mkdir -p ' + resolvedConfig.env.PIO_HOME + '; fi',
                        // Make sure some default directories exist
                        'if [ ! -d ' + resolvedConfig.env.PIO_BIN_DIRPATH + ' ]; then mkdir ' + resolvedConfig.env.PIO_BIN_DIRPATH + '; fi',
                        'if [ ! -d ' + resolvedConfig.env.PIO_HOME + '/cache ]; then mkdir ' + resolvedConfig.env.PIO_HOME + '/cache; fi',
                        'if [ ! -d ' + resolvedConfig.env.PIO_DATA_DIRPATH + ' ]; then mkdir ' + resolvedConfig.env.PIO_DATA_DIRPATH + '; fi',
                        'if [ ! -d ' + resolvedConfig.env.PIO_HOME + '/tmp ]; then mkdir ' + resolvedConfig.env.PIO_HOME + '/tmp; fi',
                        'if [ ! -d ' + resolvedConfig.env.PIO_LOG_DIRPATH + ' ]; then mkdir ' + resolvedConfig.env.PIO_LOG_DIRPATH + '; fi',
                        'if [ ! -d ' + resolvedConfig.env.PIO_RUN_DIRPATH + ' ]; then mkdir ' + resolvedConfig.env.PIO_RUN_DIRPATH + '; fi',
                        'if [ ! -d ' + resolvedConfig.env.PIO_SERVICES_DIRPATH + ' ]; then mkdir ' + resolvedConfig.env.PIO_SERVICES_DIRPATH + '; fi',
                        'if [ ! -f "' + resolvedConfig.env.PIO_BIN_DIRPATH + '/activate" ]; then',
                        '  echo "#!/bin/sh -e\nexport PATH=' + resolvedConfig.env.PIO_BIN_DIRPATH + ':$PATH" > ' + resolvedConfig.env.PIO_BIN_DIRPATH + '/activate',
                        'fi'
                    ]).then(function() {
                        return ensurePrerequisites(true);
                    });
                }

                return api.runRemoteCommands([
                    'if [ ! -e ' + resolvedConfig.env.PIO_BIN_DIRPATH + '/activate ]; then echo "[pio:trigger-ensure-prerequisites]" exit 0; fi',
	                'if [ ! -d "' + serviceConfig.remote.path + '" ]; then',
	                '  mkdir -p ' + serviceConfig.remote.path,
	//                "  " + sudoCommand + "chown -f " + state["pio.vm"].user + ":" + state["pio.vm"].user + " " + state["pio.service.deployment"].path,
	                // NOTE: When deploying as root we need to give the group write access to allow other processes to access the files.
	                // TODO: Narrow down file access by using different users and groups for different services depending on their relationships.
	//                "  " + sudoCommand + "chmod -f g+wx " + state["pio.service.deployment"].path,
	                'fi',
	                // NOTE: When deploying as root we need to give the group write access to allow other processes to access the files.
	                // TODO: Narrow down file access by using different users and groups for different services depending on their relationships.
	//                sudoCommand + 'chmod -f g+wx "' + state["pio.service.deployment"].path + '/sync" || true',                	
                ]).then(function(response) {
                    if (/\[pio:trigger-ensure-prerequisites\]/.test(response.stdout)) {
                        return ensureGlobalPrerequisites();
                    }
                });
            }

		    function prepareService () {

		    	// HACK: Remove this once we check in PGL.
		    	if (API.Q.isPromise(EXPORT)) throw new Error("'EXPORT' should be resolved to an object by now! We should never get here! Time to improve the hack!");

				function prepareAspect (aspect) {
			    	return EXPORT.export(
			    		serviceConfig.local.aspects[aspect].sourcePath,
			    		serviceConfig.local.aspects[aspect].path,
			    		"snapshot"
			    	).then(function () {
			    		if (serviceConfig.local.aspects[aspect].addFiles["package.local.json"]) {
							return EXPORT.addFile(
								API.PATH.join(serviceConfig.local.aspects[aspect].path, "package.local.json"),
								JSON.stringify(serviceConfig.local.aspects[aspect].addFiles["package.local.json"], null, 4)
				    		);
			    		}
			    	});
				}

				function writeServiceConfigs () {
					return API.Q.all(Object.keys(serviceConfig.remote.addFiles).map(function (filename) {
						return API.Q.nbind(API.FS.outputFile, API.FS)(
							API.PATH.join(serviceConfig.local.path, filename),
							JSON.stringify(serviceConfig.remote.addFiles[filename], null, 4),
			    			"utf8"
			    		);
					}));

				}

				return API.Q.all([
					prepareAspect("source"),
					prepareAspect("runtime"),
					writeServiceConfigs
				]);
		    }


	    	API.console.verbose("Upload service '" + serviceConfig.serviceId + "' from '" + serviceConfig.local.path + "' to sync path: " + serviceConfig.remote.aspects.sync.path);

	    	return API.Q.all([
	    		ensurePrerequisites(),
	    		prepareService(alias, serviceConfig)
	    	]).then(function () {
				return api.uploadFiles(serviceConfig.local.path, serviceConfig.remote.aspects.sync.path);
	    	});
	    }

	    function postdeployService(alias, serviceConfig) {
	    	API.console.verbose("Trigger postdeploy for service '" + serviceConfig.serviceId + "' at path: " + serviceConfig.remote.aspects.sync.path);
	    	return api.runRemoteCommands(
				serviceConfig.remote.aspects.source.commands,
				serviceConfig.remote.addFiles["package.service.json"].env
			);
	    }


	    API.console.verbose("Uploading services in parallel:");

	    return API.Q.all(resolvedConfig.servicesOrder.map(function (alias) {
			return uploadService(alias, resolvedConfig.services[alias]);
	    })).then(function () {

		    API.console.verbose("Running postdeploy in series:");

		    var done = API.Q.resolve();
		    resolvedConfig.servicesOrder.forEach(function (alias) {
		    	done = API.Q.when(done, function () {
					return postdeployService(alias, resolvedConfig.services[alias]);
		    	});
		    });
		    return done;

	    });
	}

	return exports;
}
