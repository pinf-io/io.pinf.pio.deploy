
const VFS_LOCAL = require("vfs-local");
const VFS_HTTP_ADAPTER = require("vfs-http-adapter");


require('org.pinf.genesis.lib/lib/api').forModule(require, module, function (API, exports) {

	// Expose a HTTP interface.
	exports["github.com/creationix/stack/0"] = VFS_HTTP_ADAPTER("/", VFS_LOCAL({
		root: __dirname
	}));

});
