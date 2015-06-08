
require('org.pinf.genesis.lib').forModule(require, module, function (API, exports) {

	exports.getServiceSyncHash = function (args) {
		return API.Q.denodeify(function (callback) {
			// TODO: Get 'PIO_SERVICES_DIRPATH' from config instead of 'process.env'.
			var smgFormDescriptorPath = API.PATH.join(process.env.PIO_SERVICES_DIRPATH, args.serviceId, "sync", ".smg.form.json");
			return API.FS.exists(smgFormDescriptorPath, function (exists) {
				if (!exists) {
					return callback(null, null);
				}
				return API.FS.readFile(smgFormDescriptorPath, "utf8", function (err, data) {
					if (err) return callback(err);

					return callback(null, {
						hash: API.CRYPTO.createHash("sha256").update(data).digest("hex")
					});
				});
			});
		})();
	}

});
