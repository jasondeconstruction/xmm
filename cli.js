#!/usr/bin/env node

const opts = {
	wallets: {
		coerse: JSON.parse,
		describe: "Dictionary of wallets",
		default: {},
		global: true
	},
	assets: {
		coerse: JSON.parse,
		describe: "Dictionary of assets",
		default: {},
		global: true
	},
	timeout: {
		alias: "t",
		describe: "Timeout in seconds for requests",
		default: 5,
		global: true
	},
	server: {
		alias: "s",
		describe: "WebSocket server URL",
		default: "wss://s1.ripple.com",
		global: true
	},
	delta: {
		alias: "d",
		describe: "Stake to trade",
		default: 0.01,
		global: true
	}
};

const home = require("os").homedir();
const conf = require("path").join(home, ".xmm.json");

function load(path)
{
	try {
		const read = require("fs").readFileSync;
		const json = read(path, "utf-8");
		const dict = JSON.parse(json);

		return dict;
	} catch (error) {
		console.warn("%s: Could not load configuration", path);

		return {};
	}
}

require("yargs")
	.usage("Usage: $0 [options] <command> [arguments]")
	.options(opts)
	.config("config", load)
	.alias("config", "c")
	.global("config")
	.default("config", conf)
	.command(require("./ledger"))
	.command(require("./balance"))
	.demand(1)
	.strict()
	.recommendCommands()
	.version()
	.alias("version", "v")
	.help()
	.alias("help", "h")
	.argv;
