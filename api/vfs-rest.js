
const VFS_LOCAL = require("vfs-local");
const VFS_LINT = require("vfs-lint");
const VFS_HTTP_ADAPTER = require("vfs-http-adapter");


require('org.pinf.genesis.lib/lib/api').forModule(require, module, function (API, exports) {

	console.log("SYNC vfs-rest API LOADED!", API.config);


	// Expose a HTTP interface.
	exports["github.com/creationix/stack/0"] = VFS_HTTP_ADAPTER("/", VFS_LOCAL({
		root: __dirname
	});

console.log("SYNC vfs-rest EXPORTS SET!");

});

