
exports.for = function (API) {

	const SSH = require("./ssh").for(API);
	const RSYNC = require("./rsync").for(API);
//	org.sourcemint.genesis.lib


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

			resolvedConfig.status = (previousResolvedConfig && previousResolvedConfig.status) || "unknown";

			if (resolvedConfig.status === "provisioned") {
				API.console.verbose("Skip provisioning prerequisites as previous status is provisioned.");
//				return resolvedConfig;
			}

			var api = makeAPI(resolvedConfig);

            function ensurePrerequisites(repeat) {
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
                    'if [ ! -e ' + resolvedConfig.env.PIO_BIN_DIRPATH + '/activate ]; then echo "[pio:trigger-ensure-prerequisites]"; fi'
                ]).then(function(response) {
                    if (/\[pio:trigger-ensure-prerequisites\]/.test(response.stdout)) {
                        return ensureGlobalPrerequisites();
                    }
                });
            }

            return ensurePrerequisites().then(function () {

//				resolvedConfig.status = "provisioned";

				resolvedConfig.status = "unknown";

resolvedConfig.t = Date.now();

				return resolvedConfig;
            });
		});
	}

	exports.turn = function (resolvedConfig) {

console.log("TURN pio.deploy", resolvedConfig);

		var api = makeAPI(resolvedConfig);

		// TODO: Make this more configurable

		function ensureServicePrerequisites (servicePath) {
	        return api.runRemoteCommands([
                'if [ ! -d "' + servicePath + '" ]; then',
                '  mkdir -p ' + servicePath,
//                "  " + sudoCommand + "chown -f " + state["pio.vm"].user + ":" + state["pio.vm"].user + " " + state["pio.service.deployment"].path,
                // NOTE: When deploying as root we need to give the group write access to allow other processes to access the files.
                // TODO: Narrow down file access by using different users and groups for different services depending on their relationships.
//                "  " + sudoCommand + "chmod -f g+wx " + state["pio.service.deployment"].path,
                'fi',
                // NOTE: When deploying as root we need to give the group write access to allow other processes to access the files.
                // TODO: Narrow down file access by using different users and groups for different services depending on their relationships.
//                sudoCommand + 'chmod -f g+wx "' + state["pio.service.deployment"].path + '/sync" || true',
	        ]);
	    }

	    function prepareService (sourcePath, serviceId, options) {

	    	API.console.verbose("Prepare service '" + serviceId + "' from source path: " + sourcePath);

	    	return API.Q.resolve(sourcePath);
	    }


	    function uploadService (sourcePath, serviceId, options) {

			var servicePath = resolvedConfig.env.PIO_SERVICES_DIRPATH + "/" + serviceId;
			var serviceSyncPath = servicePath + "/sync";

	    	return API.Q.spread([
	    		// Load descriptor and call VM to ensure minimum prerequisites exist.
	    		API.Q.nbind(API.PACKAGE.fromFile, API.PACKAGE)(API.PATH.join(sourcePath, "package.json"), {
					env: resolvedConfig.env
				}).then(function (descriptor) {
					return ensureServicePrerequisites(servicePath).then(function () {
						return descriptor;
					});
				}),
				// Get the service ready for upload.
				prepareService(sourcePath, serviceId, options)
	    	], function (descriptor, sourcePath) {

		    	API.console.verbose("Upload service '" + serviceId + "' to sync path: " + serviceSyncPath);

				return api.uploadFiles(sourcePath, serviceSyncPath).then(function () {

					var pioConfig = descriptor.configForLocator(API.LOCATOR.fromConfigId("pio.pinf.io/0"));
					function normalize (pioConfig) {
						// TODO: This should already be normalized by 'configForLocator'.
						if (!pioConfig.on) pioConfig.on = {};
						if (!pioConfig.on.postdeploy) {
							pioConfig.on.postdeploy = "io-pinf-pio-postdeploy";
						}
						if (/^\./.test(pioConfig.on.postdeploy)) {
							pioConfig.on.postdeploy = serviceSyncPath + "/" + pioConfig.on.postdeploy;
						}
						return pioConfig;
					}
					pioConfig = normalize(JSON.parse(JSON.stringify(pioConfig || {})));

					return api.runRemoteCommands([
						'cd ' + servicePath,
						'echo -e "' + JSON.stringify(options.programDescriptor || {}, null, 4).replace(/"/g, '\\"') + '" > "' + serviceSyncPath + '/package.program.json"',
						'export PIO_SERVICE_HOME=' + servicePath,
						'export PIO_SERVICE_ID_SAFE=' + serviceId.replace(/\./g, "-"),
						'export PIO_SERVICE_LOG_BASEPATH=' + resolvedConfig.env.PIO_LOG_DIRPATH + "/" + serviceId.replace(/\./g, "-"),
						'export PIO_SERVICE_RUN_BASEPATH=' + resolvedConfig.env.PIO_RUN_DIRPATH + "/" + serviceId.replace(/\./g, "-"),
						'export PIO_SERVICE_DATA_BASEPATH=' + resolvedConfig.env.PIO_DATA_DIRPATH + "/" + serviceId.replace(/\./g, "-"),
						pioConfig.on.postdeploy
	                ], resolvedConfig.env);
				});
	    	});
	    }

	    var done = API.Q.resolve();
	    API.DESCRIPTOR.sortObjByDepends(resolvedConfig.services).forEach(function (id) {
	    	done = API.Q.when(done, function () {
				return uploadService(
					// TODO: Support more advanced locators.
					API.PATH.dirname(require.resolve(resolvedConfig.services[id].location + "/package.json")),
					resolvedConfig.services[id].location,
					{
						programDescriptor: {
							config: resolvedConfig.services[id].config
						}
					}
				);
	    	});
	    });
	    return done;
	}

	return exports;
}
