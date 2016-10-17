const faucet = "https://faucet.altnet.rippletest.net/accounts";
const testnet = "wss://s.altnet.rippletest.net:51233";
const root = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const syntax = /^(|([^:@]+)(|:([^:@]+))@)([^@]+)$/;

class XMMarg {
	constructor(xmm, obj) {
		this.xmm = xmm;
		this.input = JSON.stringify(obj);
		this.type = "undefined";

		if ("string" == typeof obj)
			obj = this.parse(obj);

		if (!obj)
			return;

		this.type = obj.type;
		this.value = obj.value;
		this.asset = obj.asset;
		this.wallet = obj.wallet;
	}

	parse(str) {
		const tokens = syntax.exec(str);
		let asset, value, wallet, type;

		if (!tokens)
			return;

		asset = tokens[2];
		value = tokens[4];
		wallet = tokens[5];

		if (value)
			type = "value";
		else if (asset)
			type = "asset";
		else if (wallet)
			type = "wallet";
		else
			return;

		switch (type) {
		case "value":
			value = parseFloat(value);
			if (!isFinite(value))
				return;
		case "asset":
			asset = this.xmm.toasset(asset);
			if (!asset)
				return;
		case "wallet":
			wallet = this.xmm.toabs(wallet);
			if (!wallet)
				return;
		}

		return {
			type: type,
			value: value,
			asset: asset,
			wallet: wallet
		};
	}

	expect(type) {
		if (type != this.type)
			return `${this.input} is not ${type}`;
	}
}

class XMM {
	constructor(opts) {
		this.ledger = opts.ledger;
		this.api = opts.api;
		this.wallets = opts.wallets;
		this.assets = opts.assets;
		this.dict = {};
		this.expand();
		this.reverse();
	}

	toasset(str) {
		const obj = {};
		let asset, issuer;

		if ("string" != typeof str)
			return;

		str = str.split(".");
		asset = str.shift();
		issuer = str.shift();

		if ("XRP" == asset) {
			if (issuer)
				return;

			obj.code = asset;
			return obj;
		}

		if (issuer) {
			issuer = this.toabs(issuer);
			if (!issuer)
				return;

			obj.code = asset;
			obj.issuer = issuer;
			return obj;
		}

		return this.assets[asset];
	}

	expand() {
		const wallets = this.wallets;
		const assets = this.assets;

		for (let alias in wallets) {
			const entry = wallets[alias];

			if ("string" == typeof entry) {
				const obj = {
					address: entry
				};

				wallets[alias] = obj;
			}
		}

		for (let alias in assets) {
			const entry = assets[alias];

			if ("string" == typeof entry) {
				const pair = entry.split(".");
				const code = pair.shift();
				const issuer = pair.shift();
				const obj = {
					code: code,
					issuer: issuer
				};

				assets[alias] = obj;
			}
		}

		for (let alias in assets) {
			const entry = assets[alias];

			entry.issuer = this.toabs(entry.issuer);
		}
	}

	reverse() {
		const dict = this.dict;
		const wallets = this.wallets;
		const assets = this.assets;

		for (let alias in wallets)
			dict[wallets[alias].address] = alias;

		for (let alias in assets) {
			const asset = assets[alias];
			let issuer = asset.issuer;
			let key = asset.code;

			if (issuer) {
				issuer = this.shorten(issuer);
				key = key.concat(".", issuer);
			}

			dict[key] = alias;
		}
	}

	shorten(line) {
		const alias = this.dict[line];

		if (alias)
			return alias;

		return line;
	}

	toabs(wallet) {
		if (/^r[A-Za-z0-9]{25,}$/.test(wallet))
			return wallet;

		wallet = this.wallets[wallet];
		if (wallet)
			return wallet.address;
	}

	toxmm(obj) {
		const code = obj.currency;
		const value = obj.value;

		if (code && value) {
			let issuer = obj.counterparty;
			let asset = code;

			if (issuer) {
				issuer = this.shorten(issuer);
				asset = code.concat(".", issuer);
			}

			asset = this.shorten(asset);
			return asset.concat(":", value);
		}
	}

	tobal(list, me) {
		const iou = {};

		list = list.filter(line => {
			const value = parseFloat(line.value);

			if (value > 0)
				return true;

			if (value < 0) {
				const code = line.currency;

				if (!iou[code])
					iou[code] = 0;

				iou[code] += value;
			}

			return false;
		});

		for (let code in iou) {
			const value = iou[code].toString();

			list.push({
				currency: code,
				counterparty: me,
				value: value
			});
		}

		return list.map(line => this.toxmm(line));
	}

	balance(wallet, ledger) {
		const arg = this.parse(wallet);
		const reason = arg.expect("wallet");

		if (!ledger)
			ledger = this.ledger;

		return new Promise((resolve, reject) => {
			let me;

			if (reason) {
				reject(reason);
				return;
			}

			me = arg.wallet;

			this.api.getBalances(me, {
				ledgerVersion: ledger
			}).then(list => {
				resolve(this.tobal(list, me));
			}).catch(reject);
		});
	}

	parse(str) {
		return new XMMarg(this, str);
	}
}

exports.connect = config => new Promise(resolve => {
	const ripple = require("ripple-lib");
	const api = new ripple.RippleAPI({
		feeCushion: config.cushion,
		timeout: config.timeout * 1e3,
		server: config.server
	});
	let count = config.count > 0 ? config.count : 1;

	function tick(ledger)
	{
		if (count > 0) {
			--count;
			api.once("ledger", tick);
		} else {
			const xmm = new XMM({
				ledger: ledger.ledgerVersion,
				api: api,
				wallets: config.wallets,
				assets: config.assets
			});

			resolve(xmm);
		}
	}

	tick();
	api.connect();
});

exports.generate = opts => new Promise((resolve, reject) => {
	const request = require("request");

	function create(resolve, reject)
	{
		request.post({
			url: faucet,
			json: true
		}, (error, response, body) => {
			resolve(body.account);
		});
	}

	Promise.all([
		new Promise(create),
		new Promise(create)
	]).then(wallets => {
		resolve({
			wallets: {
				fund: wallets[0],
				bank: wallets[1],
				root: root
			},
			assets: {
				XMM: "XMM.fund",
				USD: "USD.bank",
				BTC: "BTC.bank"
			},
			server: testnet
		});
	}).catch(reject);
});
