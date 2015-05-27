
const ASSERT = require("assert");
const PATH = require("path");
const SPAWN = require("child_process").spawn;


exports.for = function (API) {

	var exports = {};

	exports.sync = function (options, callback) {

		ASSERT.equal(typeof options, "object");
		ASSERT.equal(typeof options.sourcePath, "string");
		ASSERT.equal(typeof options.targetUser, "string");
		ASSERT.equal(typeof options.targetHostname, "string");
		ASSERT.equal(typeof options.targetPath, "string");
		ASSERT.equal(typeof options.keyPath, "string");

		API.console.verbose(("Sync source '" + options.sourcePath + "' to vm at '" + options.targetPath + "'").magenta);

		var args = [
			'-avz', '--compress',
			'-e', 'ssh -o ConnectTimeout=5 -o ConnectionAttempts=1 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentityFile=' + options.keyPath		
		];
		if (options.delete) {
			args.push("--delete");
			args.push("--delete-excluded");
		}
		if (options.exclude) {
			options.exclude.forEach(function(exclude) {
				args.push("--exclude", exclude);
			});
		}
		if (options.excludeFromPath) {
			args.push("--exclude-from", options.excludeFromPath);
		}

		API.console.verbose(("Running command: rsync " + args.concat([
			options.sourcePath + '/',
			options.targetUser + '@' + options.targetHostname + ':' + options.targetPath
		]).join(" ")).magenta);

		var proc = SPAWN("/usr/bin/rsync", args.concat([
			options.sourcePath + '/',
			options.targetUser + '@' + options.targetHostname + ':' + options.targetPath
		]), {
			cwd: options.sourcePath
		});
		proc.on('error', callback);
		proc.stdout.on('data', function (data) {
			if (API.VERBOSE) {
				process.stdout.write(data);
			}
		});
		var stderr = [];
		proc.stderr.on('data', function (data) {
			stderr.push(data.toString());
			if (API.VERBOSE) {
				process.stderr.write(data);
			}
		});
		return proc.on('close', function (code) {
			if (code !== 0) {
				console.error("ERROR: rsync exited with code '" + code + "'");
				return callback(new Error("rsync exited with code '" + code + "' and stderr: " + stderr.join("")));
			}
			return callback(null);
		});
	}

	return exports;
}